import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((message, { confirmLabel = 'Delete', danger = true } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({ message, confirmLabel, danger });
    });
  }, []);

  function respond(value) {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setDialog(null);
  }

  useEffect(() => {
    if (!dialog) return;
    const handler = (e) => { if (e.key === 'Escape') respond(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dialog]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div className="confirm-overlay" onClick={() => respond(false)} role="dialog" aria-modal="true">
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="confirm-message">{dialog.message}</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => respond(false)}>
                Cancel
              </button>
              <button
                className={`btn btn-sm ${dialog.danger ? 'btn-danger-fill' : 'btn-primary'}`}
                onClick={() => respond(true)}
                autoFocus
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
