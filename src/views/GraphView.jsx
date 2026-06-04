import { useEffect, useRef, useState, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { api } from '../api.js';

// Second brain: notes are nodes, a shared tag is an edge. Reads /api/notes/graph.
export default function GraphView() {
  const wrapRef = useRef(null);
  const fgRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [data, setData] = useState({ nodes: [], links: [] });
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.noteGraph().then(setData).catch((e) => setError(e.message));
  }, []);

  // Size the canvas to the container; keep it responsive.
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomBy = useCallback((factor) => {
    const fg = fgRef.current;
    if (fg) fg.zoom(fg.zoom() * factor, 250);
  }, []);
  const reset = useCallback(() => fgRef.current?.zoomToFit(400, 50), []);

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

  return (
    <div className="view active" style={{ gap: 12 }}>
      <div className="graph-container" ref={wrapRef} style={{ flex: 1 }}>
        {empty ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            no notes yet — write journal entries and they’ll appear here, linked by shared tags
          </div>
        ) : (
          size.w > 0 && (
            <ForceGraph2D
              ref={fgRef}
              width={size.w}
              height={size.h}
              graphData={data}
              backgroundColor="rgba(0,0,0,0)"
              nodeId="id"
              nodeLabel={(n) => n.label}
              nodeColor={(n) => n.color}
              nodeVal={(n) => n.val}
              nodeRelSize={5}
              linkColor={(l) => l.color || 'rgba(255,255,255,0.12)'}
              linkWidth={1}
              onNodeClick={(n) => { setSelected(n); fgRef.current?.centerAt(n.x, n.y, 400); }}
              onEngineStop={() => fgRef.current?.zoomToFit(400, 50)}
            />
          )
        )}

        <div className="graph-legend">
          <div className="legend-row"><div className="legend-dot" style={{ background: '#9d8cff' }} />journal entries</div>
          <div className="legend-row"><div className="legend-dot" style={{ background: '#6ea8fe' }} />notes</div>
          <div className="legend-row"><div className="legend-dot" style={{ background: '#5a5a66' }} />untagged</div>
        </div>

        <div className="graph-controls">
          <button className="graph-btn" onClick={() => zoomBy(1.3)}>+</button>
          <button className="graph-btn" onClick={() => zoomBy(0.77)}>−</button>
          <button className="graph-btn" onClick={reset}>⊙</button>
        </div>
      </div>

      <div className="card" style={{ flexShrink: 0 }}>
        <div className="card-title">{selected ? selected.label : 'click a node to preview'}</div>
        <div id="graph-preview" style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          {selected ? (
            <>
              <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>{selected.preview}</div>
              {selected.tags?.length
                ? selected.tags.map((t) => <span key={t} style={{ marginRight: 8, color: 'var(--accent)' }}># {t}</span>)
                : <span>— untagged —</span>}
            </>
          ) : '— no node selected —'}
        </div>
      </div>
    </div>
  );
}
