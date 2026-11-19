// Fixture: o painel recebe o texto visível e os itens já extraídos pelo runtime do iframe.
// Aqui um extrator mínimo (sem DOM) a partir de HTML simples dos testes.

export function canvasOf(html: string, title = "Meu painel", updatedAt = Date.UTC(2026, 10, 15, 12, 0, 0)) {
  const strip = (value: string) => value.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const items: Array<{ id: string; text: string }> = [];
  for (const match of html.matchAll(/<(\w+)[^>]*data-canvas-item="([^"]+)"[^>]*>(.*?)<\/\1>/g)) items.push({ id: match[2] ?? "", text: strip(match[3] ?? "") });
  const text = html.split(/<\/(?:h\d|p|li|div|pre)>/).map((part) => strip(part).trim()).filter(Boolean).map((line, index) => {
    const item = items.find((entry) => entry.text === line);
    return item && index >= 0 ? `[#${item.id}] ${line}` : line;
  }).join("\n");
  return { title, updatedAt, text, items };
}
