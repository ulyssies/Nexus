import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { api } from '../api.js';

// Distinct, immediately-readable colors per node type (the spec's legend).
const TYPE_COLOR = {
  journal: '#5b9cf6',    // blue
  research: '#3fc7b4',   // teal
  concept: '#e0b050',    // amber/yellow (parents)
  archivist: '#5fb56a',  // green (project/commit notes)
  note: '#8a87f0',       // soft purple
  brief: '#f0a050',
  untagged: '#5a5a66',   // dim gray
};
const colorFor = (n) => (n.tags?.length || n.isConcept) ? (TYPE_COLOR[n.nodeType] || TYPE_COLOR.note) : TYPE_COLOR.untagged;
// the four primary toggles (other types always show). Commits live in the
// Projects tab, not the graph — so the knowledge types are journal/research/
// concept/note.
const TYPE_FILTERS = ['journal', 'research', 'concept', 'note'];
const SPLIT_KEY = 'nexus.graph.paneW';

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function GraphView() {
  const wrapRef = useRef(null);     // graph canvas container (for sizing)
  const splitRef = useRef(null);    // split container (for divider math)
  const fgRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [data, setData] = useState({ nodes: [], links: [] });
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(null);   // graph node
  const [detail, setDetail] = useState(null);        // full note (body, etc.)
  const [focusRoot, setFocusRoot] = useState(null);  // cluster-focus root node id
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState({});          // type -> true (hidden)
  const [paneW, setPaneW] = useState(() => Number(localStorage.getItem(SPLIT_KEY)) || 360);
  const drag = useRef(null);

  useEffect(() => { api.noteGraph().then(setData).catch((e) => setError(e.message)); }, []);

  // Spread into a clean constellation: strong, long-range repulsion pushes nodes
  // apart, roomy links, and very loose shared-tag cliques (low strength) so dense
  // tag groups breathe instead of collapsing into a blob.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !data.nodes.length) return;
    fg.d3Force('charge')?.strength(-360).distanceMax(750);
    const link = fg.d3Force('link');
    if (link) {
      link.distance((l) => (l.kind === 'parent' ? 50 : 100));
      link.strength((l) => (l.kind === 'parent' ? 0.6 : 0.09));
    }
    fg.d3ReheatSimulation?.();
  }, [data, size.w]);

  // size the canvas to its container
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selected]);   // re-measure when the pane opens/closes

  // ── derived structure: degree (for weighting), children, tag-neighbors ──────
  const { degree, childrenOf, tagNeighbors, byId } = useMemo(() => {
    const degree = new Map(), childrenOf = new Map(), tagNeighbors = new Map(), byId = new Map();
    for (const n of data.nodes) { byId.set(n.id, n); degree.set(n.id, 0); }
    for (const n of data.nodes) {
      if (n.parentId != null) { (childrenOf.get(n.parentId) || childrenOf.set(n.parentId, []).get(n.parentId)).push(n.id); }
    }
    for (const l of data.links) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      degree.set(s, (degree.get(s) || 0) + 1);
      degree.set(t, (degree.get(t) || 0) + 1);
      if (l.kind === 'tag') {
        (tagNeighbors.get(s) || tagNeighbors.set(s, new Set()).get(s)).add(t);
        (tagNeighbors.get(t) || tagNeighbors.set(t, new Set()).get(t)).add(s);
      }
    }
    return { degree, childrenOf, tagNeighbors, byId };
  }, [data]);

  // nodes in the current focus cluster: root + children + grandchildren
  const focusSet = useMemo(() => {
    if (focusRoot == null) return null;
    const set = new Set([focusRoot]);
    for (const c of (childrenOf.get(focusRoot) || [])) {
      set.add(c);
      for (const g of (childrenOf.get(c) || [])) set.add(g);
    }
    return set;
  }, [focusRoot, childrenOf]);

  const q = query.trim().toLowerCase();
  const matches = useCallback((n) =>
    !q ? false : (n.label?.toLowerCase().includes(q) || n.preview?.toLowerCase().includes(q) || (n.tags || []).some((t) => t.toLowerCase().includes(q))),
    [q]);

  const typeHidden = useCallback((n) => {
    const t = (n.tags?.length || n.isConcept) ? n.nodeType : 'untagged';
    return TYPE_FILTERS.includes(t) && hidden[t];
  }, [hidden]);

  // final per-node opacity: type filter → search → focus → default
  const alphaOf = useCallback((n) => {
    if (typeHidden(n)) return 0.04;
    if (q) return matches(n) ? 1 : 0.12;
    if (focusSet) return focusSet.has(n.id) ? 1 : 0.1;
    return 1;
  }, [q, matches, focusSet, typeHidden]);

  // ── selection / focus ───────────────────────────────────────────────────────
  const openNode = useCallback((node) => {
    const n = typeof node === 'object' ? node : byId.get(node);
    if (!n) return;
    setSelected(n);
    setDetail(null);
    api.note(n.id).then((r) => setDetail(r.note)).catch(() => {});
    fgRef.current?.centerAt(n.x, n.y, 400);
    // clicking a concept/parent enters cluster-focus mode
    if (n.isConcept || (childrenOf.get(n.id) || []).length) setFocusRoot(n.id);
  }, [byId, childrenOf]);

  const closePane = () => { setSelected(null); setDetail(null); };
  const exitFocus = () => setFocusRoot(null);

  const zoomBy = (f) => { const g = fgRef.current; if (g) g.zoom(g.zoom() * f, 250); };
  const reset = () => { exitFocus(); fgRef.current?.zoomToFit(400, 90); };

  // ── divider drag (persisted) ────────────────────────────────────────────────
  function startDrag(e) {
    e.preventDefault();
    drag.current = true;
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
  }
  function onDrag(e) {
    if (!drag.current || !splitRef.current) return;
    const right = splitRef.current.getBoundingClientRect().right;
    setPaneW(Math.min(640, Math.max(280, right - e.clientX)));
  }
  function endDrag() {
    drag.current = false;
    localStorage.setItem(SPLIT_KEY, String(Math.round(paneW)));
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', endDrag);
  }

  // ── canvas drawing ──────────────────────────────────────────────────────────
  const drawNode = useCallback((n, ctx, scale) => {
    const a = alphaOf(n);
    const r = 3.2 + Math.sqrt(degree.get(n.id) || 1) * 2.1;   // weighted by connections
    const col = colorFor(n);
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = col;
    ctx.fill();
    if (selected?.id === n.id || (q && matches(n))) {
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = selected?.id === n.id ? '#ffffff' : col;
      ctx.stroke();
    }
    // node names are intentionally NOT drawn — they show on hover (nodeLabel
    // tooltip) so the graph reads as a clean map instead of overlapping text.
    ctx.globalAlpha = 1;
  }, [alphaOf, degree, selected, q, matches]);

  const paintPointer = useCallback((n, color, ctx) => {
    const r = 2.2 + Math.sqrt(degree.get(n.id) || 1) * 1.7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r + 1.5, 0, 2 * Math.PI);
    ctx.fill();
  }, [degree]);

  const linkAlpha = useCallback((l) => {
    const s = typeof l.source === 'object' ? l.source : byId.get(l.source);
    const t = typeof l.target === 'object' ? l.target : byId.get(l.target);
    if (!s || !t) return 0.1;
    return Math.min(alphaOf(s), alphaOf(t));
  }, [alphaOf, byId]);

  if (error) {
    return (
      <div className="view active">
        <div className="card">
          <div className="card-title">couldn't load the graph</div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}</p>
        </div>
      </div>
    );
  }

  const empty = data.nodes.length === 0;
  const children = selected ? (childrenOf.get(selected.id) || []).map((id) => byId.get(id)).filter(Boolean) : [];
  const parent = selected?.parentId != null ? byId.get(selected.parentId) : null;
  const connected = selected ? [...(tagNeighbors.get(selected.id) || [])].map((id) => byId.get(id)).filter(Boolean).slice(0, 12) : [];

  return (
    <div className="view active" style={{ gap: 12 }}>
      {/* search + type filters + focus state */}
      <div className="graph-toolbar">
        <input className="graph-search" placeholder="search notes…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="graph-type-toggles">
          {TYPE_FILTERS.map((t) => (
            <button key={t} className={`type-toggle${hidden[t] ? ' off' : ''}`} onClick={() => setHidden((h) => ({ ...h, [t]: !h[t] }))}>
              <span className="type-dot" style={{ background: TYPE_COLOR[t] }} />{t}
            </button>
          ))}
        </div>
        {focusRoot != null && (
          <button className="btn" style={{ fontSize: 11, padding: '4px 11px' }} onClick={exitFocus}>✕ exit focus</button>
        )}
      </div>

      <div className="graph-split" ref={splitRef}>
        <div className="graph-container" ref={wrapRef}>
          {empty ? (
            <div className="graph-empty">no notes yet — write journal entries (or run <code>npm run seed:brain</code>) and they’ll appear here, linked by shared tags</div>
          ) : size.w > 0 && (
            <ForceGraph2D
              ref={fgRef}
              width={size.w}
              height={size.h}
              graphData={data}
              backgroundColor="rgba(0,0,0,0)"
              nodeId="id"
              nodeLabel={(n) => `${n.label}${n.tags?.length ? ` · #${n.tags.join(' #')}` : ''}`}
              nodeCanvasObject={drawNode}
              nodePointerAreaPaint={paintPointer}
              linkColor={(l) => l.kind === 'parent' ? hexA('#e0b050', linkAlpha(l) * 0.9) : hexA('#9aa0b5', linkAlpha(l) * 0.28)}
              linkLineDash={(l) => l.kind === 'parent' ? null : [2.5, 3]}
              linkWidth={(l) => l.kind === 'parent' ? 1.8 : 0.7}
              linkDirectionalArrowLength={(l) => l.kind === 'parent' ? 4 : 0}
              linkDirectionalArrowRelPos={1}
              onNodeClick={openNode}
              onBackgroundClick={() => { exitFocus(); }}
              onEngineStop={() => fgRef.current?.zoomToFit(400, 90)}
            />
          )}

          <div className="graph-legend">
            {[['journal', '#5b9cf6'], ['research', '#3fc7b4'], ['concept / parent', '#e0b050'], ['note', '#8a87f0'], ['untagged', '#5a5a66']].map(([l, c]) => (
              <div className="legend-row" key={l}><div className="legend-dot" style={{ background: c }} />{l}</div>
            ))}
            <div className="legend-row" style={{ marginTop: 4, color: 'var(--text-dim)' }}>
              <span style={{ color: '#e0b050' }}>→</span>&nbsp;hierarchy (solid) · <span style={{ letterSpacing: '-1px' }}>--</span> tag (dashed)
            </div>
          </div>

          <div className="graph-controls">
            <button className="graph-btn" onClick={() => zoomBy(1.3)}>+</button>
            <button className="graph-btn" onClick={() => zoomBy(0.77)}>−</button>
            <button className="graph-btn" onClick={reset}>⊙</button>
          </div>
        </div>

        {selected && (
          <>
            <div className="graph-divider" onPointerDown={startDrag} />
            <aside className="graph-pane" style={{ width: paneW }}>
              <div className="gp-head">
                <span className="gp-type" style={{ color: colorFor(selected), borderColor: colorFor(selected) }}>
                  {selected.isConcept ? 'concept' : selected.nodeType}
                </span>
                <button className="gp-close" onClick={closePane} aria-label="close">✕</button>
              </div>
              <div className="gp-scroll">
                <h3 className="gp-title">{selected.label}</h3>
                <p className="gp-body">{detail ? (detail.body || '—') : 'loading…'}</p>

                {selected.tags?.length > 0 && (
                  <div className="gp-section">
                    <div className="gp-label">tags · click to filter</div>
                    <div className="gp-tags">
                      {selected.tags.map((t) => (
                        <button key={t} className="gp-tag" onClick={() => { exitFocus(); setQuery(t); }}>#{t}</button>
                      ))}
                    </div>
                  </div>
                )}

                {parent && (
                  <div className="gp-section">
                    <div className="gp-label">parent</div>
                    <button className="gp-link" onClick={() => openNode(parent)}>↑ {parent.label}</button>
                  </div>
                )}

                {children.length > 0 && (
                  <div className="gp-section">
                    <div className="gp-label">children · {children.length}</div>
                    {children.map((c) => (
                      <button key={c.id} className="gp-link" onClick={() => openNode(c)}>↳ {c.label}</button>
                    ))}
                  </div>
                )}

                {connected.length > 0 && (
                  <div className="gp-section">
                    <div className="gp-label">connected by shared tags · {connected.length}</div>
                    {connected.map((c) => (
                      <button key={c.id} className="gp-link dim" onClick={() => openNode(c)}>• {c.label}</button>
                    ))}
                  </div>
                )}

                <div className="gp-meta">
                  {detail?.created_at && <span>created {String(detail.created_at).slice(0, 10)}</span>}
                  <span>source · {detail?.source_agent || selected.kind}</span>
                </div>
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
