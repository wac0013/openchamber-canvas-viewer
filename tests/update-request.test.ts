import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requestCanvasUpdate, UPDATE_MESSAGES, UPDATE_SENT_MESSAGE } from "../src/canvas/update-request.ts";
import { UPDATE_MIN_INTERVAL_MS, UPDATE_REQUEST_MARKER, UPDATE_REQUEST_TEXT } from "../src/shared/contract.ts";
import { createUpdateRequester, type UpdateHost } from "../service/update-request.ts";

type Status = "idle" | "busy" | "waiting";

function setup(statuses: Record<string, Status> = {}, options: { failStatus?: unknown; failSend?: unknown; gate?: Promise<void> } = {}) {
  const sent: Array<{ sessionId: string; prompt: string }> = [];
  const asked: string[] = [];
  let clock = 1_000_000;
  const host: UpdateHost = {
    async status(sessionId) {
      asked.push(sessionId);
      if (options.gate) await options.gate;
      if (options.failStatus) throw options.failStatus;
      return { status: statuses[sessionId] ?? "idle" };
    },
    async send(sessionId, prompt) {
      if (options.failSend) throw options.failSend;
      sent.push({ sessionId, prompt });
      return { sent: true };
    },
  };
  const requester = createUpdateRequester(host, () => clock);
  return { requester, sent, asked, advance: (ms: number) => { clock += ms; } };
}

describe("texto do pedido (RN3)", () => {
  it("começa com o marcador, é fixo e cita a ferramenta, os ids e o resumo curto", () => {
    assert.ok(UPDATE_REQUEST_TEXT.startsWith(UPDATE_REQUEST_MARKER));
    for (const part of ["canvas_publish", "mesmos ids de elemento", "Não repita a visualização no chat"]) assert.ok(UPDATE_REQUEST_TEXT.includes(part), part);
    assert.ok(UPDATE_REQUEST_TEXT.length < 400);
  });
});

describe("createUpdateRequester", () => {
  it("CA1: agente ocioso → envia o texto fixo para a sessão pedida", async () => {
    const { requester, sent } = setup();
    assert.deepEqual(await requester.request("ses_A"), { ok: true });
    assert.deepEqual(sent, [{ sessionId: "ses_A", prompt: UPDATE_REQUEST_TEXT }]);
  });

  it("CA5: o envio vai para o id explícito, não para outra sessão", async () => {
    const { requester, sent, asked } = setup();
    await requester.request("ses_A");
    await requester.request("ses_B");
    assert.deepEqual(asked, ["ses_A", "ses_B"]);
    assert.deepEqual(sent.map((s) => s.sessionId), ["ses_A", "ses_B"]);
  });

  it("CA2: agente trabalhando → não envia e informa", async () => {
    const { requester, sent } = setup({ ses_A: "busy" });
    assert.deepEqual(await requester.request("ses_A"), { ok: false, code: "busy" });
    assert.deepEqual(sent, []);
  });

  it("CA3: agente esperando resposta do usuário → não envia (enviar fecharia a pergunta pendente)", async () => {
    const { requester, sent } = setup({ ses_A: "waiting" });
    assert.deepEqual(await requester.request("ses_A"), { ok: false, code: "waiting" });
    assert.deepEqual(sent, []);
  });

  it("CA4/RN5: segundo pedido logo depois é recusado; passado o intervalo volta a valer", async () => {
    const { requester, sent, advance } = setup();
    assert.equal((await requester.request("ses_A")).ok, true);
    assert.deepEqual(await requester.request("ses_A"), { ok: false, code: "too-soon" });
    advance(UPDATE_MIN_INTERVAL_MS - 1);
    assert.deepEqual(await requester.request("ses_A"), { ok: false, code: "too-soon" });
    advance(1);
    assert.equal((await requester.request("ses_A")).ok, true);
    assert.equal(sent.length, 2);
  });

  it("CA4: dois cliques simultâneos enviam UMA mensagem (a vaga é reservada antes do await)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { requester, sent } = setup({}, { gate });
    const first = requester.request("ses_A");
    const second = requester.request("ses_A");
    assert.deepEqual(await second, { ok: false, code: "too-soon" });
    release();
    assert.deepEqual(await first, { ok: true });
    assert.equal(sent.length, 1);
  });

  it("sessões diferentes não se bloqueiam", async () => {
    const { requester, sent } = setup();
    const [a, b] = await Promise.all([requester.request("ses_A"), requester.request("ses_B")]);
    assert.deepEqual([a.ok, b.ok], [true, true]);
    assert.equal(sent.length, 2);
  });

  it("pedido recusado por busy/waiting não consome a vaga: dá para tentar de novo logo", async () => {
    const statuses: Record<string, Status> = { ses_A: "busy" };
    const { requester, sent } = setup(statuses);
    assert.equal((await requester.request("ses_A")).ok, false);
    statuses.ses_A = "idle";
    assert.equal((await requester.request("ses_A")).ok, true);
    assert.equal(sent.length, 1);
  });

  it("ids que não sejam id de sessão são recusados antes de falar com o host", async () => {
    const { requester, asked } = setup();
    for (const id of ["", "../x", "a b", "x".repeat(129), "a\u0000b"]) {
      assert.deepEqual(await requester.request(id), { ok: false, code: "invalid-session" });
    }
    assert.deepEqual(asked, []);
  });

  it("NOT_GRANTED do host vira 'not-granted'; qualquer outra falha vira 'host-refused', sem eco da mensagem", async () => {
    const granted = Object.assign(new Error("segredo-interno"), { code: "NOT_GRANTED" });
    assert.deepEqual(await setup({}, { failStatus: granted }).requester.request("ses_A"), { ok: false, code: "not-granted" });
    const other = setup({}, { failSend: new Error("segredo-interno") });
    const result = await other.requester.request("ses_A");
    assert.deepEqual(result, { ok: false, code: "host-refused" });
    assert.equal(JSON.stringify(result).includes("segredo"), false);
  });

  it("falha ao enviar libera a vaga (o usuário pode tentar de novo)", async () => {
    let fail = true;
    const sent: string[] = [];
    const requester = createUpdateRequester({ status: async () => ({ status: "idle" }), send: async (id) => { if (fail) throw new Error("x"); sent.push(id); } }, () => 5);
    assert.equal((await requester.request("ses_A")).ok, false);
    fail = false;
    assert.equal((await requester.request("ses_A")).ok, true);
    assert.deepEqual(sent, ["ses_A"]);
  });

  it("não acumula memória de sessões antigas", async () => {
    const { requester, advance } = setup();
    for (let i = 0; i < 50; i += 1) await requester.request(`ses_${i}`);
    advance(UPDATE_MIN_INTERVAL_MS);
    assert.equal((await requester.request("ses_novo")).ok, true);
  });
});

describe("requestCanvasUpdate (lado do painel)", () => {
  const host = (status: number, body: string) => ({ serviceRequest: async () => ({ status, body }) });

  it("manda POST /update-request só com o id da sessão (o painel não envia texto)", async () => {
    let seen: { method: string; path: string; body?: string } | null = null;
    const h = { serviceRequest: async (request: { method: string; path: string; body?: string }) => { seen = request; return { status: 200, body: '{"ok":true}' }; } };
    assert.deepEqual(await requestCanvasUpdate(h as never, "ses_A"), { ok: true });
    assert.deepEqual(seen, { method: "POST", path: "/update-request", body: '{"sessionId":"ses_A"}' });
  });

  it("traduz cada código do serviço para uma razão com mensagem ao usuário", async () => {
    for (const code of ["busy", "waiting", "too-soon", "not-granted", "host-refused", "invalid-session"] as const) {
      const result = await requestCanvasUpdate(host(409, JSON.stringify({ ok: false, code })), "ses_A");
      assert.deepEqual(result, { ok: false, reason: code });
      assert.ok(UPDATE_MESSAGES[code].message.length > 10);
    }
  });

  it("CA7: 404 (serviço sem a rota) → serviço desatualizado", async () => {
    assert.deepEqual(await requestCanvasUpdate(host(404, '{"ok":false}'), "ses_A"), { ok: false, reason: "service-outdated" });
  });

  it("resposta inesperada, código desconhecido ou serviço fora → indisponível", async () => {
    assert.deepEqual(await requestCanvasUpdate(host(200, "não é json"), "ses_A"), { ok: false, reason: "unavailable" });
    assert.deepEqual(await requestCanvasUpdate(host(409, '{"ok":false,"code":"inventado"}'), "ses_A"), { ok: false, reason: "unavailable" });
    assert.deepEqual(await requestCanvasUpdate(host(200, "null"), "ses_A"), { ok: false, reason: "unavailable" });
    const down = { serviceRequest: async () => { throw new Error("x"); } };
    assert.deepEqual(await requestCanvasUpdate(down as never, "ses_A"), { ok: false, reason: "unavailable" });
  });

  it("toda razão tem tipo (info/erro) e texto; há texto de sucesso", () => {
    assert.ok(UPDATE_SENT_MESSAGE.length > 10);
    for (const entry of Object.values(UPDATE_MESSAGES)) {
      assert.ok(entry.kind === "info" || entry.kind === "error");
      assert.ok(entry.message.length > 10);
    }
  });
});
