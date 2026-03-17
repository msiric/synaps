// src/visualizer.ts — Full-viewport codebase topology visualization.
// The graph IS the page. Structural imports + behavioral co-change edges
// rendered simultaneously on a dark canvas. Click to explore blast radius.

import type { StructuredAnalysis } from "./types.js";

type Pkg = StructuredAnalysis["packages"][0];

export function generateReport(analysis: StructuredAnalysis): string {
  const pkg = analysis.packages[0];
  if (!pkg) return "<html><body><p>No packages found.</p></body></html>";

  const graph = buildGraphData(pkg);
  const importData = (pkg.importChain ?? []).map((e) => [e.source, e.importer, e.symbolCount]);
  const cochangeData = (pkg.gitHistory?.coChangeEdges ?? []).map((e) => [
    e.file1,
    e.file2,
    Math.round(e.jaccard * 100),
  ]);
  const clusterData = pkg.coChangeClusters ?? [];

  const statsHtml = [
    ["Files", pkg.files.total],
    ["Imports", pkg.importChain?.length ?? 0],
    ["Co-changes", pkg.gitHistory?.coChangeEdges?.length ?? 0],
    ["Clusters", pkg.coChangeClusters?.length ?? 0],
    ["Flows", pkg.executionFlows?.length ?? 0],
  ]
    .map(([l, v]) => `<div class="s"><span class="sv">${v}</span><span class="sl">${l}</span></div>`)
    .join("");

  const flowsHtml = (pkg.executionFlows ?? [])
    .slice(0, 6)
    .map((f) => {
      const conf =
        f.confidence >= 0.3
          ? '<i class="dot dot-g"></i>'
          : f.confidence > 0
            ? '<i class="dot dot-a"></i>'
            : '<i class="dot dot-m"></i>';
      return `<div class="fl">${conf}<span>${esc(f.steps.join(" \u2192 "))}</span></div>`;
    })
    .join("");

  const convHtml = [
    ...(pkg.conventions ?? []).map(
      (c) => `<div class="cv cv-do">${esc(c.name)} <span class="cd">${c.confidence.percentage}%</span></div>`,
    ),
    ...(pkg.antiPatterns ?? []).map((a) => `<div class="cv cv-no">${esc(a.rule)}</div>`),
  ].join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(pkg.name)} \u2014 Codebase Topology</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0f;color:#e0e0e0}
svg{display:block;width:100%;height:100%}
.hdr{position:fixed;top:0;left:0;right:0;padding:16px 24px;display:flex;align-items:center;gap:16px;z-index:10;pointer-events:none}
.hdr>*{pointer-events:auto}
.hdr h1{font-size:18px;font-weight:700;letter-spacing:-0.02em;white-space:nowrap}
.hdr .tag{font-size:11px;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,0.08);color:#888}
.stats{display:flex;gap:2px;margin-left:auto}
.s{text-align:center;padding:4px 12px}
.sv{display:block;font-size:16px;font-weight:700;color:#7aa2f7}
.sl{display:block;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#555}
.legend{position:fixed;bottom:16px;left:24px;display:flex;gap:16px;font-size:11px;color:#555;z-index:10}
.legend i{display:inline-block;width:20px;height:2px;vertical-align:middle;margin-right:4px;border-radius:1px}
.leg-imp{background:#333}
.leg-coc{background:#c59a28;opacity:0.7}
.leg-impl{background:#b44e8a;opacity:0.7}
.panel{position:fixed;top:0;right:0;width:300px;height:100%;background:#0d0d14;border-left:1px solid #1a1a24;z-index:20;transform:translateX(100%);transition:transform 0.25s ease;overflow-y:auto;padding:20px}
.panel.open{transform:translateX(0)}
.panel h2{font-size:15px;font-weight:700;margin-bottom:2px}
.panel .sub{font-size:12px;color:#555;margin-bottom:16px}
.panel h3{font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#444;margin:14px 0 6px}
.panel ul{list-style:none}
.panel li{font-size:12px;padding:4px 0;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #111}
.panel li:last-child{border:none}
.panel code{font-size:11px;color:#8a8a9a}
.badge{font-size:9px;padding:1px 6px;border-radius:99px;font-weight:600}
.badge-b{background:rgba(122,162,247,0.15);color:#7aa2f7}
.badge-a{background:rgba(197,154,40,0.15);color:#c59a28}
.badge-p{background:rgba(180,78,138,0.15);color:#b44e8a}
.close-btn{position:absolute;top:12px;right:12px;background:none;border:none;color:#444;font-size:18px;cursor:pointer;padding:4px 8px}
.close-btn:hover{color:#888}
.drawer{position:fixed;bottom:0;left:0;right:0;z-index:10;pointer-events:none}
.drawer>*{pointer-events:auto}
.dtoggle{display:flex;justify-content:center}
.dtoggle button{font-size:11px;padding:4px 16px;border-radius:6px 6px 0 0;border:1px solid #1a1a24;border-bottom:none;background:#0d0d14;color:#666;cursor:pointer}
.dtoggle button:hover{color:#999}
.dcontent{background:#0d0d14;border-top:1px solid #1a1a24;max-height:0;overflow:hidden;transition:max-height 0.3s ease}
.dcontent.open{max-height:300px;overflow-y:auto}
.dcontent-inner{padding:16px 24px;display:flex;gap:32px}
.dcol{flex:1;min-width:200px}
.dcol h3{font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#444;margin-bottom:8px}
.fl{font-size:11px;color:#666;padding:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fl span{margin-left:4px}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%}
.dot-g{background:#4ade80}.dot-a{background:#c59a28}.dot-m{background:#333}
.cv{font-size:11px;padding:4px 8px;margin:2px 0;border-radius:4px;border-left:3px solid}
.cv-do{border-color:#4ade80;background:rgba(74,222,128,0.05);color:#777}
.cv-no{border-color:#f87171;background:rgba(248,113,113,0.05);color:#777}
.cd{font-size:9px;color:#555}
.hint{position:fixed;bottom:50px;left:50%;transform:translateX(-50%);font-size:12px;color:#333;z-index:5;transition:opacity 0.5s}
</style>
</head>
<body>
<div class="hdr">
  <h1>${esc(pkg.name)}</h1>
  <span class="tag">${pkg.architecture.packageType}</span>
  <div class="stats">${statsHtml}</div>
</div>
<div class="legend">
  <span><i class="leg-imp"></i>import</span>
  <span><i class="leg-coc" style="border:1px dashed #c59a28;height:0;width:20px"></i>co-change</span>
  <span><i class="leg-impl" style="border:1px dotted #b44e8a;height:0;width:20px"></i>implicit coupling</span>
  <span style="margin-left:8px;opacity:0.6">|</span>
  <span>colored nodes = co-change cluster</span>
</div>
<div class="hint" id="hint">click a module to explore its blast radius</div>
<svg id="graph"></svg>
<div class="panel" id="panel">
  <button class="close-btn" onclick="closePanel()">&times;</button>
  <div id="panel-content"></div>
</div>
<div class="drawer">
  <div class="dtoggle"><button onclick="toggleDrawer()">Flows &amp; Conventions</button></div>
  <div class="dcontent" id="drawer">
    <div class="dcontent-inner">
      <div class="dcol"><h3>Execution Flows</h3>${flowsHtml || '<div class="fl">No flows detected</div>'}</div>
      <div class="dcol"><h3>Conventions</h3>${convHtml || '<div class="cv">No conventions detected</div>'}</div>
    </div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script>
const G=${JSON.stringify(graph)};
const IM=${JSON.stringify(importData)};
const CC=${JSON.stringify(cochangeData)};
const CL=${JSON.stringify(clusterData)};
const PAL=['#7aa2f7','#4ade80','#c59a28','#f87171','#a78bfa','#e879a0','#38bdf8','#fb923c'];
const W=innerWidth,H=innerHeight;
const svg=d3.select('#graph').attr('viewBox',[0,0,W,H]);
const maxW=Math.max(1,...G.edges.map(e=>e.weight));
const maxF=Math.max(1,...G.nodes.map(n=>n.files));
const NC=G.nodes.length;
const linkDist=NC>50?60:NC>20?100:NC>12?150:220;
const charge=NC>50?-200:NC>20?-400:NC>12?-800:-1400;
const center=NC>50?0.12:NC>20?0.06:0.03;
const nodeR=NC>50?6:NC>20?8:12;
const sim=d3.forceSimulation(G.nodes)
  .force('link',d3.forceLink(G.edges).id(d=>d.id).distance(linkDist))
  .force('charge',d3.forceManyBody().strength(charge))
  .force('center',d3.forceCenter(W/2,H/2))
  .force('collision',d3.forceCollide().radius(d=>nodeR+4+Math.sqrt(d.files/maxF)*(NC>50?10:NC>20?18:28)))
  .force('x',d3.forceX(W/2).strength(center))
  .force('y',d3.forceY(H/2).strength(center));
const link=svg.append('g').selectAll('line').data(G.edges).join('line')
  .attr('stroke',d=>d.type==='cochange'?'#c59a28':d.type==='implicit'?'#b44e8a':'#222')
  .attr('stroke-width',d=>d.type==='cochange'||d.type==='implicit'?1.5:Math.max(0.8,Math.sqrt(d.weight/maxW)*4))
  .attr('stroke-dasharray',d=>d.type==='cochange'?'6,4':d.type==='implicit'?'2,3':'none')
  .attr('opacity',d=>d.type==='import'?0.35:0.5);
const defs=svg.append('defs');
const glow=defs.append('filter').attr('id','glow');
glow.append('feGaussianBlur').attr('stdDeviation','3').attr('result','blur');
const m=glow.append('feMerge');m.append('feMergeNode').attr('in','blur');m.append('feMergeNode').attr('in','SourceGraphic');
const node=svg.append('g').selectAll('g').data(G.nodes).join('g')
  .call(d3.drag().on('start',(e,d)=>{if(!e.active)sim.alphaTarget(.3).restart();d.fx=d.x;d.fy=d.y})
    .on('drag',(e,d)=>{d.fx=e.x;d.fy=e.y}).on('end',(e,d)=>{if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null}))
  .on('click',(e,d)=>{e.stopPropagation();selectNode(d)})
  .style('cursor','pointer');
node.append('circle')
  .attr('r',d=>nodeR+Math.sqrt(d.files/maxF)*(NC>50?12:NC>20?20:32))
  .attr('fill',d=>d.group>=0?PAL[d.group%PAL.length]+'22':'#151520')
  .attr('stroke',d=>d.group>=0?PAL[d.group%PAL.length]:'#282830')
  .attr('stroke-width',1.5);
function lbl(d){const p=d.id.split('/');if(p.length<=1)return d.id||'root';const l=p.at(-1);return G.nodes.filter(n=>n.id.split('/').at(-1)===l).length>1?p.slice(-2).join('/'):l}
const fontSize=NC>50?'9px':NC>20?'10px':'13px';
const labelOffset=NC>50?12:NC>20?16:22;
node.append('text').text(d=>lbl(d))
  .attr('text-anchor','middle').attr('dy',d=>-(labelOffset+Math.sqrt(d.files/maxF)*(NC>50?12:NC>20?20:34)))
  .attr('font-size',fontSize).attr('fill','#888').attr('font-weight','600')
  .attr('paint-order','stroke').attr('stroke','#0a0a0f').attr('stroke-width',NC>50?2:4);
node.append('text').text(d=>d.files)
  .attr('text-anchor','middle').attr('dy',NC>50?3:5)
  .attr('font-size',NC>50?'8px':fontSize).attr('fill','#555').attr('font-weight','700');
const pad=60;
sim.on('tick',()=>{
  G.nodes.forEach(d=>{d.x=Math.max(pad,Math.min(W-pad,d.x));d.y=Math.max(pad,Math.min(H-pad,d.y))});
  link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
  node.attr('transform',d=>\`translate(\${d.x},\${d.y})\`);
});
function selectNode(d){
  document.getElementById('hint').style.opacity='0';
  node.select('circle').attr('opacity',.15).attr('filter',null);
  link.attr('opacity',.04);
  node.filter(n=>n.id===d.id).select('circle').attr('opacity',1).attr('filter','url(#glow)').attr('stroke-width',2.5);
  const conn=new Set();
  G.edges.forEach(e=>{const s=typeof e.source==='object'?e.source.id:e.source,t=typeof e.target==='object'?e.target.id:e.target;if(s===d.id)conn.add(t);if(t===d.id)conn.add(s)});
  node.filter(n=>conn.has(n.id)).select('circle').attr('opacity',.85);
  link.filter(e=>{const s=typeof e.source==='object'?e.source.id:e.source,t=typeof e.target==='object'?e.target.id:e.target;return s===d.id||t===d.id}).attr('opacity',.9);
  const dir=d.id;
  const imp=IM.filter(e=>(e[0].startsWith(dir+'/')||e[0]===dir)&&!e[1].startsWith(dir+'/'));
  const coc=CC.filter(e=>((e[0].startsWith(dir+'/')||e[0]===dir)&&!e[1].startsWith(dir+'/'))||((e[1].startsWith(dir+'/')||e[1]===dir)&&!e[0].startsWith(dir+'/')));
  const seen=new Set();const ucoc=coc.filter(e=>{const k=e[0]+e[1];if(seen.has(k))return false;seen.add(k);return true});
  const cl=CL.filter(c=>c.some(f=>f.startsWith(dir+'/')||f===dir));
  let h='<h2>'+dir+'/</h2>';
  h+='<div class="sub">'+d.files+' files &middot; '+d.imports+' imported &middot; '+d.exports+' exported</div>';
  if(imp.length){h+='<h3>Imported by ('+imp.length+')</h3><ul>';imp.slice(0,10).forEach(e=>{h+='<li><code>'+e[1].split('/').slice(-2).join('/')+'</code><span class="badge badge-b">'+e[2]+'</span></li>'});h+='</ul>'}
  if(ucoc.length){h+='<h3>Co-change partners</h3><ul>';ucoc.slice(0,6).forEach(e=>{const p=(e[0].startsWith(dir+'/')||e[0]===dir)?e[1]:e[0];h+='<li><code>'+p.split('/').slice(-2).join('/')+'</code><span class="badge badge-a">'+e[2]+'%</span></li>'});h+='</ul>'}
  if(cl.length){h+='<h3>Cluster membership</h3><ul>';cl.forEach(c=>{h+='<li><span>'+c.length+'-file cluster</span><span class="badge badge-p">clique</span></li>'});h+='</ul>'}
  if(!imp.length&&!ucoc.length&&!cl.length){h+='<div style="color:#333;padding:16px 0">No external dependencies detected</div>'}
  document.getElementById('panel-content').innerHTML=h;
  document.getElementById('panel').classList.add('open');
}
function closePanel(){
  document.getElementById('panel').classList.remove('open');
  node.select('circle').attr('opacity',1).attr('filter',null).attr('stroke-width',1.5);
  link.attr('opacity',d=>d.type==='import'?.35:.5);
}
svg.on('click',()=>closePanel());
function toggleDrawer(){document.getElementById('drawer').classList.toggle('open')}
</script>
</body>
</html>`;
}

// ─── Graph Data ──────────────────────────────────────────────────────────────

interface GNode {
  id: string;
  files: number;
  imports: number;
  exports: number;
  group: number;
}
interface GEdge {
  source: string;
  target: string;
  weight: number;
  type: "import" | "cochange" | "implicit";
}

function buildGraphData(pkg: Pkg): { nodes: GNode[]; edges: GEdge[] } {
  const importEdges = pkg.importChain ?? [];
  const coChangeEdges = pkg.gitHistory?.coChangeEdges ?? [];
  const implicitEdges = pkg.implicitCoupling ?? [];
  const clusters = pkg.coChangeClusters ?? [];

  // Determine aggregation depth: count unique dirs at full depth, reduce if too many
  const fullDirs = new Set<string>();
  for (const e of importEdges) {
    fullDirs.add(fdir(e.importer));
    fullDirs.add(fdir(e.source));
  }
  const maxNodes = 30;
  let depth = 10; // effectively unlimited
  if (fullDirs.size > maxNodes) {
    // Try progressively shallower depths until we get <=maxNodes
    for (depth = 3; depth >= 1; depth--) {
      const test = new Set<string>();
      for (const e of importEdges) {
        test.add(fdirN(e.importer, depth));
        test.add(fdirN(e.source, depth));
      }
      if (test.size <= maxNodes) break;
    }
    if (depth < 1) depth = 1;
  }
  const dir = (p: string) => (fullDirs.size > maxNodes ? fdirN(p, depth) : fdir(p));

  const ds = new Map<string, { files: Set<string>; imports: number; exports: number }>();
  const de = new Map<string, number>();

  for (const e of importEdges) {
    const f = dir(e.importer);
    const t = dir(e.source);
    for (const d of [f, t]) if (!ds.has(d)) ds.set(d, { files: new Set(), imports: 0, exports: 0 });
    ds.get(f)!.files.add(e.importer);
    ds.get(t)!.files.add(e.source);
    ds.get(f)!.imports += e.symbolCount;
    ds.get(t)!.exports += e.symbolCount;
    if (f !== t) {
      const k = `${f}|${t}`;
      de.set(k, (de.get(k) ?? 0) + e.symbolCount);
    }
  }

  const ce = new Map<string, number>();
  for (const e of coChangeEdges) {
    const a = dir(e.file1);
    const b = dir(e.file2);
    if (a === b) continue;
    const k = [a, b].sort().join("|");
    ce.set(k, (ce.get(k) ?? 0) + e.jaccard);
  }

  const ie = new Map<string, number>();
  for (const e of implicitEdges) {
    const a = dir(e.file1);
    const b = dir(e.file2);
    if (a === b) continue;
    const k = [a, b].sort().join("|");
    ie.set(k, (ie.get(k) ?? 0) + e.jaccard);
  }

  const dc = new Map<string, number>();
  for (let i = 0; i < clusters.length; i++) {
    for (const f of clusters[i]) {
      const d = dir(f);
      if (!dc.has(d)) dc.set(d, i);
    }
  }

  const nodes: GNode[] = [...ds.entries()].map(([id, s]) => ({
    id,
    files: s.files.size,
    imports: s.imports,
    exports: s.exports,
    group: dc.get(id) ?? -1,
  }));

  const edges: GEdge[] = [];
  for (const [k, w] of de) {
    const [s, t] = k.split("|");
    edges.push({ source: s, target: t, weight: w, type: "import" });
  }
  for (const [k, w] of ce) {
    const [s, t] = k.split("|");
    if (!de.has(`${s}|${t}`) && !de.has(`${t}|${s}`)) {
      edges.push({ source: s, target: t, weight: Math.round(w * 20), type: "cochange" });
    }
  }
  for (const [k, w] of ie) {
    const [s, t] = k.split("|");
    const ck = [s, t].sort().join("|");
    if (!ce.has(ck) && !de.has(`${s}|${t}`) && !de.has(`${t}|${s}`)) {
      edges.push({ source: s, target: t, weight: Math.round(w * 15), type: "implicit" });
    }
  }

  return { nodes, edges };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fdir(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : ".";
}

/** Get directory path limited to N segments: "a/b/c/d/file.ts" at depth 2 → "a/b" */
function fdirN(p: string, depth: number): string {
  const d = fdir(p);
  const parts = d.split("/");
  return parts.length <= depth ? d : parts.slice(0, depth).join("/");
}
