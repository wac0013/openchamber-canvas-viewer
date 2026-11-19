// Kit opcional de componentes (`<link data-kit>` no HTML do canvas). Classes `ck-*` e variáveis
// `--ck-*` derivadas do tema do OpenChamber (`--oc-*`), com padrões escuros para a página do navegador.
// Fica em TypeScript (string) para ser importado igual por painel, servidor e testes.

export const KIT_CSS = `
:root{--ck-bg:var(--oc-bg,#16161a);--ck-elevated:var(--oc-elevated,#1f1f25);--ck-fg:var(--oc-fg,#ececf1);--ck-muted:var(--oc-muted,#9a9aa5);--ck-border:var(--oc-border,#34343c);--ck-primary:var(--oc-primary-text,var(--oc-primary,#8ab4ff));--ck-success:var(--oc-success,#3fb97a);--ck-warning:var(--oc-warning,#d9a441);--ck-error:var(--oc-error,#e5646b);--ck-info:var(--oc-info,#5aa7e8);--ck-radius:var(--oc-radius,8px);--ck-gap:10px}
.ck-card{background:var(--ck-elevated);border:1px solid var(--ck-border);border-radius:var(--ck-radius);padding:10px 12px;margin:0 0 var(--ck-gap)}
.ck-card>h1,.ck-card>h2,.ck-card>h3{margin:0 0 6px;font-size:13px}
.ck-grid{display:grid;gap:var(--ck-gap);grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin:0 0 var(--ck-gap)}
.ck-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ck-muted{color:var(--ck-muted)}
.ck-mono{font-family:var(--oc-mono,monospace)}
.ck-table{width:100%;border-collapse:collapse;margin:0 0 var(--ck-gap)}
.ck-table th,.ck-table td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--ck-border);vertical-align:top}
.ck-table th{color:var(--ck-muted);font-weight:600;font-size:12px}
.ck-badge{display:inline-block;padding:0 8px;border:1px solid var(--ck-border);border-radius:999px;font-size:11px;line-height:18px;color:var(--ck-muted)}
.ck-badge[data-tone=success]{color:var(--ck-success);border-color:var(--ck-success)}
.ck-badge[data-tone=warning]{color:var(--ck-warning);border-color:var(--ck-warning)}
.ck-badge[data-tone=error]{color:var(--ck-error);border-color:var(--ck-error)}
.ck-badge[data-tone=info]{color:var(--ck-info);border-color:var(--ck-info)}
.ck-stat{display:flex;flex-direction:column;gap:2px}
.ck-stat-value{font-size:22px;font-weight:600;line-height:1.1}
.ck-stat-label{font-size:11px;color:var(--ck-muted)}
.ck-steps{list-style:none;margin:0 0 var(--ck-gap);padding:0;display:flex;flex-direction:column;gap:6px}
.ck-step{display:flex;gap:8px;align-items:flex-start;padding:6px 10px;border:1px solid var(--ck-border);border-left:3px solid var(--ck-border);border-radius:var(--ck-radius);background:var(--ck-elevated)}
.ck-step[data-tone=success]{border-left-color:var(--ck-success)}
.ck-step[data-tone=warning]{border-left-color:var(--ck-warning)}
.ck-step[data-tone=error]{border-left-color:var(--ck-error)}
.ck-step[data-tone=info]{border-left-color:var(--ck-info)}
.ck-bar{height:8px;background:var(--ck-border);border-radius:999px;overflow:hidden}
.ck-bar>span{display:block;height:100%;width:var(--value,0%);background:var(--ck-primary)}
.ck-bar[data-tone=success]>span{background:var(--ck-success)}
.ck-bar[data-tone=warning]>span{background:var(--ck-warning)}
.ck-bar[data-tone=error]>span{background:var(--ck-error)}
.ck-chart-bars{display:flex;flex-direction:column;gap:6px;margin:0 0 var(--ck-gap)}
.ck-chart-bars>div{display:grid;grid-template-columns:minmax(80px,25%) 1fr auto;gap:8px;align-items:center}
.ck-timeline{list-style:none;margin:0 0 var(--ck-gap);padding:0 0 0 14px;border-left:2px solid var(--ck-border)}
.ck-timeline>li{position:relative;padding:0 0 10px 10px}
.ck-timeline>li::before{content:"";position:absolute;left:-20px;top:5px;width:8px;height:8px;border-radius:50%;background:var(--ck-primary)}
.ck-chip{display:inline-block;padding:1px 10px;border:1px solid var(--ck-border);border-radius:999px;font-size:12px}
[data-filter].ck-chip:hover{border-color:var(--ck-primary)}
`.trim();
