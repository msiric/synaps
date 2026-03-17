// src/visualizer.ts — Full-viewport file-level codebase topology visualization.
// Every file is a node. Files cluster by directory via force simulation.
// Import edges + co-change edges + implicit coupling rendered simultaneously.

import type { StructuredAnalysis } from "./types.js";

type Pkg = StructuredAnalysis["packages"][0];

export function generateReport(analysis: StructuredAnalysis): string {
  const pkg = analysis.packages[0];
  if (!pkg) return "<html><body><p>No packages found.</p></body></html>";

  const graph = buildFileGraph(pkg);
  const cochangeData = (pkg.gitHistory?.coChangeEdges ?? []).map((e) => [
    e.file1,
    e.file2,
    Math.round(e.jaccard * 100),
  ]);

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
.panel li{font-size:12px;padding:4px 6px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #111;border-radius:4px}
.panel li[onclick]{cursor:pointer;transition:background 0.15s}
.panel li[onclick]:hover{background:rgba(255,255,255,0.04)}
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
/* ── Default visual state (all via CSS so .sel class can override) ── */
.n-c{opacity:1;stroke-width:1px}
.n-t{opacity:1;font-size:8px;font-weight:500}
.edge-i{opacity:0.2;stroke-width:0.4px}
.edge-c{opacity:0.5;stroke-width:1.2px}
.edge-m{opacity:0.5;stroke-width:1.2px}
.hull-v{fill-opacity:0.05;stroke-opacity:0.15;stroke-width:1.5px}
.dir-l{opacity:0.7;font-size:13px}
/* ── Selection: dim everything with one class toggle ── */
svg.sel .n-c{opacity:0.12;filter:none}
svg.sel .n-t{opacity:0.15}
svg.sel .edge-i,svg.sel .edge-c,svg.sel .edge-m{opacity:0.03}
svg.sel .hull-v{fill-opacity:0.02;stroke-opacity:0.06;stroke-width:1.5px}
svg.sel .dir-l{opacity:0.25;font-size:13px}
/* ── Highlight tiers (override dim) ── */
svg.sel .hl>.n-c,svg.sel .n-c.hl{opacity:1}
svg.sel .hl>.n-t,svg.sel .n-t.hl{opacity:1}
svg.sel .hl-conn>.n-c{opacity:0.8}
svg.sel .hl-conn>.n-t{opacity:0.8}
svg.sel .hl-ext>.n-c{opacity:0.5}
svg.sel .hl-ext>.n-t{opacity:0.5}
svg.sel .hl-sel>.n-c{opacity:1;stroke-width:2px}
svg.sel .hl-sel>.n-t{opacity:1;font-size:11px;font-weight:700}
svg.sel .edge-i.hl{opacity:0.55;stroke-width:0.8px}
svg.sel .edge-c.hl,svg.sel .edge-m.hl{opacity:0.7;stroke-width:1.4px}
svg.sel .hull-v.hl{fill-opacity:0.12;stroke-opacity:0.6;stroke-width:2.5px}
svg.sel .dir-l.hl{opacity:1;font-size:15px}
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
  <span>color = directory group</span>
</div>
<div class="hint" id="hint">click a file to explore its connections</div>
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
const CC=${JSON.stringify(cochangeData)};
const PAL=['#7aa2f7','#4ade80','#c59a28','#f87171','#a78bfa','#e879a0','#38bdf8','#fb923c'];
const W=innerWidth,H=innerHeight;
const svg=d3.select('#graph').attr('viewBox',[0,0,W,H]);

const NC=G.nodes.length;
const maxImp=Math.max(1,...G.nodes.map(n=>n.importedBy));

// Directory cluster centers — spread across the full viewport
const dirs=[...new Set(G.nodes.map(n=>n.dir))];
const dirCenters={};
dirs.forEach((d,i)=>{
  const angle=(2*Math.PI*i)/dirs.length - Math.PI/2;
  const rx=W*0.38,ry=H*0.36;
  dirCenters[d]={x:W/2+Math.cos(angle)*rx, y:H/2+Math.sin(angle)*ry};
});

// Directory label colors
const dirColor={};
dirs.forEach((d,i)=>{dirColor[d]=PAL[i%PAL.length]});

// Force simulation — strong directory clustering, strong inter-cluster repulsion
const sim=d3.forceSimulation(G.nodes)
  .force('link',d3.forceLink(G.edges).id(d=>d.id).distance(30).strength(0.15))
  .force('charge',d3.forceManyBody().strength(-80))
  .force('collision',d3.forceCollide().radius(14))
  .force('x',d3.forceX(d=>dirCenters[d.dir].x).strength(0.35))
  .force('y',d3.forceY(d=>dirCenters[d.dir].y).strength(0.35));

// ── Pre-computed indexes (built once, used everywhere) ──

// 1. dirNodes: dir → node[] (eliminates repeated G.nodes.filter per dir)
const dirNodes={};
dirs.forEach(d=>{dirNodes[d]=[]});
G.nodes.forEach(n=>dirNodes[n.dir].push(n));

// 2. Resolved edge IDs: after forceLink init, source/target are objects.
//    Pre-resolve to avoid typeof checks at every call site (~15 occurrences).
G.edges.forEach(e=>{e._s=e.source.id||e.source;e._t=e.target.id||e.target});

// 3. adj: nodeId → edge[] (eliminates full edge scans on selection)
const adj={};
G.nodes.forEach(n=>{adj[n.id]=[]});
G.edges.forEach(e=>{adj[e._s].push(e);if(e._s!==e._t)adj[e._t].push(e)});

// 4. nodeById: fast node lookup for navTo
const nodeById={};
G.nodes.forEach(n=>{nodeById[n.id]=n});

// Directory group hulls
const hullLayer=svg.append('g');
const hullPad=30;
const hulls=hullLayer.selectAll('path').data(dirs).join('path')
  .attr('class','hull-v')
  .attr('fill',d=>dirColor[d]).attr('stroke',d=>dirColor[d])
  .attr('stroke-linejoin','round').attr('pointer-events','none');

// Directory name labels — prominent, above hull
const dirLabels=hullLayer.selectAll('text').data(dirs).join('text')
  .attr('class','dir-l')
  .attr('text-anchor','middle')
  .attr('fill',d=>dirColor[d])
  .attr('font-weight','700')
  .attr('paint-order','stroke').attr('stroke','#0a0a0f').attr('stroke-width',4)
  .text(d=>{const p=d.split('/');return p.at(-1)||d})
  .style('cursor','pointer')
  .on('click',(e,d)=>{e.stopPropagation();selectDir(d)});

function computeHullPath(points,pad){
  if(points.length<1)return'';
  if(points.length===1)return'M'+(points[0][0]-pad)+','+(points[0][1]-pad)+' a'+pad+','+pad+' 0 1,0 '+(pad*2)+',0 a'+pad+','+pad+' 0 1,0 '+(-pad*2)+',0';
  if(points.length===2){const[a,b]=points;const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.sqrt(dx*dx+dy*dy)||1;const nx=-dy/len*pad,ny=dx/len*pad;const expanded=[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]];const cx=d3.mean(expanded,p=>p[0]),cy=d3.mean(expanded,p=>p[1]);const rounded=expanded.map(p=>{const ddx=p[0]-cx,ddy=p[1]-cy,l=Math.sqrt(ddx*ddx+ddy*ddy)||1;return[p[0]+ddx/l*pad*0.5,p[1]+ddy/l*pad*0.5]});return'M'+rounded.map(p=>p[0]+','+p[1]).join('L')+'Z'}
  const hull=d3.polygonHull(points);
  if(!hull)return'';
  // Expand hull outward by pad
  const cx=d3.mean(hull,p=>p[0]),cy=d3.mean(hull,p=>p[1]);
  const expanded=hull.map(p=>{const dx=p[0]-cx,dy=p[1]-cy,len=Math.sqrt(dx*dx+dy*dy)||1;return[p[0]+dx/len*pad,p[1]+dy/len*pad]});
  return'M'+expanded.map(p=>p[0]+','+p[1]).join('L')+'Z';
}

// Glow filters
const defs=svg.append('defs');
const glow=defs.append('filter').attr('id','glow');
glow.append('feGaussianBlur').attr('stdDeviation','3').attr('result','blur');
const mg=glow.append('feMerge');mg.append('feMergeNode').attr('in','blur');mg.append('feMergeNode').attr('in','SourceGraphic');

// Edges — invisible wide hit-area lines behind visible edges for easier clicking
const linkG=svg.append('g');
const linkHit=linkG.selectAll('line.hit').data(G.edges).join('line')
  .attr('class','hit').attr('stroke','transparent').attr('stroke-width',12)
  .style('cursor','pointer')
  .on('click',(e,d)=>{e.stopPropagation();selectEdge(d)});
const link=linkG.selectAll('line.vis').data(G.edges).join('line')
  .attr('class',d=>d.type==='cochange'?'vis edge-c':d.type==='implicit'?'vis edge-m':'vis edge-i')
  .attr('stroke',d=>d.type==='cochange'?'#c59a28':d.type==='implicit'?'#b44e8a':'#1a1a1f')
  .attr('stroke-dasharray',d=>d.type==='cochange'?'5,3':d.type==='implicit'?'2,3':'none')
  .attr('pointer-events','none');

// Interactive hull overlay — between edges and nodes so hull gaps are draggable
const hullInteract=svg.append('g').selectAll('path').data(dirs).join('path')
  .attr('fill','transparent').attr('stroke','none')
  .attr('pointer-events','all').style('cursor','pointer')
  .on('click',(e,d)=>{e.stopPropagation();selectDir(d)});

// File nodes — on top so individual node drag/click takes priority
const node=svg.append('g').selectAll('g').data(G.nodes).join('g')
  .call(d3.drag().on('start',(e,d)=>{if(!e.active)sim.alphaTarget(.3).restart();d.fx=d.x;d.fy=d.y})
    .on('drag',(e,d)=>{d.fx=e.x;d.fy=e.y}).on('end',(e,d)=>{if(!e.active)sim.alphaTarget(0)}))
  .on('click',(e,d)=>{e.stopPropagation();selectFile(d)})
  .style('cursor','pointer');

node.append('circle')
  .attr('class','n-c')
  .attr('r',d=>5+Math.sqrt(d.importedBy/maxImp)*14)
  .attr('fill',d=>dirColor[d.dir]+'33')
  .attr('stroke',d=>dirColor[d.dir]);

// ALL files get labels
node.append('text')
  .attr('class','n-t')
  .text(d=>d.name)
  .attr('text-anchor','middle')
  .attr('dy',d=>-(9+Math.sqrt(d.importedBy/maxImp)*14))
  .attr('fill','#555')
  .attr('paint-order','stroke').attr('stroke','#0a0a0f').attr('stroke-width',3);

const pad=50;
// Per-dir tick cache: hull path string, centroid x, min y (reused by hull + labels)
const dirTick={};dirs.forEach(d=>{dirTick[d]={path:'',cx:0,minY:0}});

sim.on('tick',()=>{
  // Clamp nodes to viewport
  G.nodes.forEach(d=>{d.x=Math.max(pad,Math.min(W-pad,d.x));d.y=Math.max(pad,Math.min(H-pad,d.y))});
  // Update edge positions
  link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
  linkHit.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
  // Update node positions
  node.attr('transform',d=>\`translate(\${d.x},\${d.y})\`);
  // Compute per-dir hull + label data in a single pass (was 3 separate filter scans per dir)
  for(const d of dirs){
    const ns=dirNodes[d];
    if(!ns.length){dirTick[d].path='';continue}
    const pts=ns.map(n=>[n.x,n.y]);
    dirTick[d].path=computeHullPath(pts,hullPad);
    let sx=0,minY=Infinity;
    for(let i=0;i<ns.length;i++){sx+=ns[i].x;if(ns[i].y<minY)minY=ns[i].y}
    dirTick[d].cx=sx/ns.length;
    dirTick[d].minY=minY;
  }
  hulls.attr('d',d=>dirTick[d].path);
  hullInteract.attr('d',d=>dirTick[d].path);
  dirLabels.attr('x',d=>dirTick[d].cx).attr('y',d=>dirTick[d].minY-(hullPad+8));
});

function clearHighlights(){
  node.classed('hl',false).classed('hl-sel',false).classed('hl-conn',false).classed('hl-ext',false);
  node.select('circle').attr('filter',null);
  link.classed('hl',false).attr('stroke',d=>d.type==='cochange'?'#c59a28':d.type==='implicit'?'#b44e8a':'#1a1a1f');
  hulls.classed('hl',false);
  dirLabels.classed('hl',false);
}

function selectFile(d){
  document.getElementById('hint').style.opacity='0';
  clearHighlights();
  svg.classed('sel',true);

  // Highlight selected node (1 element)
  node.filter(n=>n.id===d.id).classed('hl-sel',true).select('circle').attr('filter','url(#glow)');

  // Build connected set + categorized edges from adjacency index
  const myEdges=adj[d.id]||[];
  const conn=new Set();
  const imp=[],impBy=[];
  for(const e of myEdges){
    const other=e._s===d.id?e._t:e._s;
    conn.add(other);
    if(e.type==='import'){if(e._s===d.id)imp.push(e);else impBy.push(e)}
  }
  // Highlight connected nodes
  node.filter(n=>conn.has(n.id)).classed('hl-conn',true);
  // Highlight connected edges (brighter stroke, no filter, no raise)
  link.filter(e=>e._s===d.id||e._t===d.id).classed('hl',true)
    .attr('stroke',e=>e.type==='cochange'?'#e8b83a':e.type==='implicit'?'#d468a8':'#556');

  // Panel
  const path=d.id;
  const coc=CC.filter(e=>e[0]===path||e[1]===path);
  const seen=new Set();const ucoc=coc.filter(e=>{const k=e[0]+e[1];if(seen.has(k))return false;seen.add(k);return true});

  let h='<h2>'+d.name+'</h2>';
  h+='<div class="sub">'+d.dir+'/ &middot; imported by '+d.importedBy+' files</div>';
  if(impBy.length){h+='<h3>Imported by ('+impBy.length+')</h3><ul>';impBy.slice(0,10).forEach(e=>{h+='<li onclick="navTo(\\''+e._s+'\\')"><code>'+e._s.split('/').pop()+'</code><span class="badge badge-b">'+e.weight+'</span></li>'});h+='</ul>'}
  if(imp.length){h+='<h3>Imports ('+imp.length+')</h3><ul>';imp.slice(0,10).forEach(e=>{h+='<li onclick="navTo(\\''+e._t+'\\')"><code>'+e._t.split('/').pop()+'</code><span class="badge badge-b">'+e.weight+'</span></li>'});h+='</ul>'}
  if(ucoc.length){h+='<h3>Co-changes</h3><ul>';ucoc.slice(0,8).forEach(e=>{const p=e[0]===path?e[1]:e[0];h+='<li onclick="navTo(\\''+p+'\\')"><code>'+p.split('/').pop()+'</code><span class="badge badge-a">'+e[2]+'%</span></li>'});h+='</ul>'}
  document.getElementById('panel-content').innerHTML=h;
  document.getElementById('panel').classList.add('open');
}

function selectDir(dir){
  document.getElementById('hint').style.opacity='0';
  clearHighlights();
  svg.classed('sel',true);

  // Highlight selected directory hull + label (2 elements)
  hulls.filter(d=>d===dir).classed('hl',true);
  dirLabels.filter(d=>d===dir).classed('hl',true);

  // Highlight all files in this directory
  node.filter(d=>d.dir===dir).classed('hl',true);

  // Build dir file set from pre-computed dirNodes
  const files=dirNodes[dir]||[];
  const dirFileSet=new Set(files.map(n=>n.id));

  // Highlight connected edges (brighter stroke, no filter, no raise)
  link.filter(e=>dirFileSet.has(e._s)||dirFileSet.has(e._t)).classed('hl',true)
    .attr('stroke',e=>e.type==='cochange'?'#e8b83a':e.type==='implicit'?'#d468a8':'#556');

  // Find connected external nodes via adjacency index
  const connNodes=new Set();
  for(const f of files){
    for(const e of adj[f.id]||[]){
      const other=e._s===f.id?e._t:e._s;
      if(!dirFileSet.has(other))connNodes.add(other);
    }
  }
  node.filter(n=>connNodes.has(n.id)).classed('hl-ext',true);

  // Panel
  const totalImp=files.reduce((s,f)=>s+f.importedBy,0);
  let h='<h2>'+dir+'/</h2>';
  h+='<div class="sub">'+files.length+' files &middot; '+totalImp+' total imports</div>';
  h+='<h3>Files</h3><ul>';
  files.slice().sort((a,b)=>b.importedBy-a.importedBy).forEach(f=>{
    h+='<li onclick="navTo(\\''+f.id+'\\')"><code>'+f.name+'</code><span class="badge badge-b">'+f.importedBy+'</span></li>';
  });
  h+='</ul>';
  const dirPrefix=dir+'/';
  const coc=CC.filter(e=>(e[0].startsWith(dirPrefix)&&!e[1].startsWith(dirPrefix))||(e[1].startsWith(dirPrefix)&&!e[0].startsWith(dirPrefix)));
  if(coc.length){
    const seen=new Set();const ucoc=coc.filter(e=>{const k=e[0]+e[1];if(seen.has(k))return false;seen.add(k);return true});
    h+='<h3>Co-changes with other dirs</h3><ul>';
    ucoc.slice(0,8).forEach(e=>{const p=e[0].startsWith(dirPrefix)?e[1]:e[0];h+='<li onclick="navTo(\\''+p+'\\')"><code>'+p.split('/').pop()+'</code><span class="badge badge-a">'+e[2]+'%</span></li>'});
    h+='</ul>';
  }
  document.getElementById('panel-content').innerHTML=h;
  document.getElementById('panel').classList.add('open');
}

function selectEdge(d){
  document.getElementById('hint').style.opacity='0';
  clearHighlights();
  svg.classed('sel',true);
  const s=d._s,t=d._t;
  // Highlight the two endpoint nodes
  node.filter(n=>n.id===s||n.id===t).classed('hl',true).select('circle').attr('filter','url(#glow)');
  // Highlight the clicked edge
  link.filter(e=>(e._s===s&&e._t===t)||(e._s===t&&e._t===s)).classed('hl',true)
    .attr('stroke',d.type==='cochange'?'#e8b83a':d.type==='implicit'?'#d468a8':'#7aa2f7');
  // Panel content
  const sName=s.split('/').pop(), tName=t.split('/').pop();
  const typeLabel=d.type==='cochange'?'Co-change':d.type==='implicit'?'Implicit Coupling':'Import';
  const typeColor=d.type==='cochange'?'badge-a':d.type==='implicit'?'badge-p':'badge-b';
  let h='<h2>Connection</h2>';
  h+='<div class="sub"><span class="badge '+typeColor+'">'+typeLabel+'</span></div>';
  h+='<h3>Source</h3><ul><li onclick="navTo(\\''+s+'\\')"><code>'+sName+'</code></li></ul>';
  h+='<h3>Target</h3><ul><li onclick="navTo(\\''+t+'\\')"><code>'+tName+'</code></li></ul>';
  if(d.type==='import'){h+='<h3>Symbols imported</h3><ul><li>'+d.weight+' symbol'+(d.weight!==1?'s':'')+'</li></ul>'}
  if(d.type==='cochange'){h+='<h3>Co-change similarity</h3><ul><li>Jaccard: '+d.weight+'%</li></ul><p style="font-size:11px;color:#555;margin-top:8px">These files frequently change together in commits, suggesting a functional relationship.</p>'}
  if(d.type==='implicit'){h+='<h3>Coupling strength</h3><ul><li>Jaccard: '+d.weight+'%</li></ul><p style="font-size:11px;color:#555;margin-top:8px">These files co-change in commits but have no direct import relationship\\u2014a potential hidden dependency.</p>'}
  document.getElementById('panel-content').innerHTML=h;
  document.getElementById('panel').classList.add('open');
}

function navTo(fileId){
  const target=nodeById[fileId];
  if(target)selectFile(target);
}

function closePanel(){
  document.getElementById('panel').classList.remove('open');
  svg.classed('sel',false);
  clearHighlights();
}
svg.on('click',()=>closePanel());
function toggleDrawer(){document.getElementById('drawer').classList.toggle('open')}
</script>
</body>
</html>`;
}

// ─── File-Level Graph Data ───────────────────────────────────────────────────

interface FNode {
  id: string; // full file path
  name: string; // filename only
  dir: string; // directory
  importedBy: number;
}

interface FEdge {
  source: string;
  target: string;
  weight: number;
  type: "import" | "cochange" | "implicit";
}

function buildFileGraph(pkg: Pkg): { nodes: FNode[]; edges: FEdge[] } {
  const importEdges = pkg.importChain ?? [];
  const coChangeEdges = pkg.gitHistory?.coChangeEdges ?? [];
  const implicitEdges = pkg.implicitCoupling ?? [];

  // Collect all files and their import counts
  const files = new Map<string, number>(); // path → importedBy count
  for (const e of importEdges) {
    if (!files.has(e.importer)) files.set(e.importer, 0);
    files.set(e.source, (files.get(e.source) ?? 0) + 1);
  }

  const nodes: FNode[] = [...files.entries()].map(([path, importedBy]) => ({
    id: path,
    name: path.split("/").pop()!,
    dir: fdir(path),
    importedBy,
  }));

  const fileSet = new Set(files.keys());
  const edges: FEdge[] = [];

  // Import edges (file to file)
  for (const e of importEdges) {
    edges.push({ source: e.importer, target: e.source, weight: e.symbolCount, type: "import" });
  }

  // Co-change edges (only between files that are in the graph)
  for (const e of coChangeEdges) {
    if (fileSet.has(e.file1) && fileSet.has(e.file2)) {
      edges.push({
        source: e.file1,
        target: e.file2,
        weight: Math.round(e.jaccard * 100),
        type: "cochange",
      });
    }
  }

  // Implicit coupling edges
  for (const e of implicitEdges) {
    if (fileSet.has(e.file1) && fileSet.has(e.file2)) {
      edges.push({
        source: e.file1,
        target: e.file2,
        weight: Math.round(e.jaccard * 100),
        type: "implicit",
      });
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
