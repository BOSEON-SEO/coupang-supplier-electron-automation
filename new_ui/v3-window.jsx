// Draggable window wrapper used by both calendar root and job/plugin windows
const { useRef, useEffect, useState } = React;

function DraggableWindow({ id, title, subtitle, swatchColor, pluginBadge, children, pos, setPos, onFocus, onClose, focused, zIndex, w, h, kind, locked, lockMessage }) {
  const dragRef = useRef(null);
  const onMouseDown = (e) => {
    if (e.target.closest('button')) return;
    onFocus && onFocus();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  };
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPos({ x: Math.max(-100, dragRef.current.origX + dx), y: Math.max(0, dragRef.current.origY + dy) });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [setPos]);

  const cls = 'window' + (focused ? ' focused' : '') + (kind === 'plugin' ? ' plugin' : '');
  return (
    <div className={cls} style={{left: pos.x, top: pos.y, width: w, height: h, zIndex}} onMouseDown={onFocus}>
      <div className="titlebar" onMouseDown={onMouseDown}>
        <div className="ttl">
          {swatchColor && <span className="swatch" style={{background: swatchColor}}/>}
          {title}
        </div>
        {subtitle && (
          <div className="meta">
            {subtitle}
            {pluginBadge && <span className="plugin-badge"><I.Plug size={9}/>{pluginBadge}</span>}
          </div>
        )}
        <div className="titlebar-spacer"/>
        <div className="ctrls">
          <button title="최소화"><I.Min size={11}/></button>
          <button title="크게"><I.Maximize size={11}/></button>
          {onClose && <button className="close" onClick={onClose} title="닫기"><I.Close size={12}/></button>}
        </div>
      </div>
      <div className={'win-body' + (locked ? ' locked' : '')}>
        {children}
        {locked && (
          <div className="win-lock-banner">
            <span className="dot"/>
            <I.Plug size={14} stroke="var(--plugin)"/>
            {lockMessage || '플러그인 작업 중 — 메인 잠금'}
          </div>
        )}
      </div>
    </div>
  );
}

window.DraggableWindow = DraggableWindow;
