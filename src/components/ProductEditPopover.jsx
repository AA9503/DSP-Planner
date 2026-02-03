import {createPortal} from 'react-dom';

export function ProductEditPopover({ isOpen, onClose, product, position, onDelete, onUpdate, onAddRecipe }) {
    if (!isOpen || !product) return null;
    const popoverStyle = {
        position: 'absolute', top: position.y + 10, left: position.x, transform: 'translateX(-50%)',
        backgroundColor: '#2d2d2d', border: '1px solid #555', borderRadius: '4px', padding: '10px',
        zIndex: 2000, boxShadow: '0 4px 12px rgba(0,0,0,0.5)', width: '220px'
    };
    return createPortal(
        <div className="fp-popover-overlay" onClick={onClose} style={{position:'fixed', top:0, left:0, width:'100%', height:'100%', zIndex: 1999}}>    
            <div style={popoverStyle} onClick={e => e.stopPropagation()}>
                <div className="d-flex justify-content-between align-items-center mb-2">
                    <span style={{fontWeight: 'bold', color: '#fff'}}>{product.name}</span>
                    <button className="btn btn-sm btn-link text-white p-0" onClick={onClose}>&times;</button>
                </div>
                <div className="mb-2">
                    <label className="form-label" style={{fontSize:'12px', color:'#aaa'}}>目标产量 (个/分)</label>
                    <input type="number" className="form-control form-control-sm bg-dark text-white border-secondary" 
                        value={product.count} onChange={(e) => onUpdate(product.id, Number(e.target.value))} />
                </div>
                <div className="d-grid gap-2">
                    <button className="btn btn-sm btn-primary" onClick={() => { onAddRecipe(product); onClose(); }}>添加配方</button>
                    <button className="btn btn-sm btn-danger" onClick={() => onDelete(product.id)}>删除物品</button>
                </div>
            </div>
        </div>, document.body
    );
}
