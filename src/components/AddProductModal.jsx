import {useContext, useState} from 'react';
import {createPortal} from 'react-dom';
import {ItemIcon} from '../icon.jsx';
import {GameInfoContext} from '../contexts';

export function AddProductModal({ isOpen, onClose, onConfirm }) {
    const game_info = useContext(GameInfoContext);
    const [selectedItem, setSelectedItem] = useState(null);
    const [amount, setAmount] = useState(60);
    const [searchTerm, setSearchTerm] = useState("");

    if (!isOpen) return null;
    
    const icon_grid = game_info.icon_grid;
    
    let doms = [];
    if (icon_grid && icon_grid.icons) {
        doms = icon_grid.icons.map(({col, row, item}) => {
             // Basic Filter
             if (searchTerm && !item.toLowerCase().includes(searchTerm.toLowerCase())) return null;
             
             return (
                 <div key={item}
                    className={`fp-grid-item ${item === selectedItem ? 'selected' : ''}`}
                    style={{gridRow: row, gridColumn: col}}
                    onClick={() => setSelectedItem(item)}
                 >
                    <ItemIcon item={item} size={40} tooltip={true}/>
                 </div>
             );
        });
    }

    return createPortal(
        <div className="fp-modal-overlay" onClick={onClose}>
            <div className="fp-modal" onClick={e => e.stopPropagation()} style={{
                width: '1000px', 
                maxWidth:'95vw', 
                height: '80vh', 
                display: 'flex', 
                flexDirection: 'column'
            }}>
                <div className="fp-modal-header" style={{flexShrink:0}}>
                    <span>添加目标产物</span>
                    <button className="btn-close btn-close-white" onClick={onClose}></button>
                </div>
                <div className="fp-modal-body" style={{
                    flexGrow: 1, 
                    display: 'flex', 
                    flexDirection: 'column', 
                    overflow: 'hidden',
                    padding: '10px'
                }}>
                    <div className="d-flex align-items-center gap-3 mb-2 p-2 bg-dark rounded flex-shrink-0" style={{border: '1px solid #444'}}>
                         <div style={{
                             minWidth: 48, minHeight: 48, 
                             display:'flex', alignItems:'center', justifyContent:'center', 
                             border:'1px dashed #666', borderRadius:'4px', background:'#222'
                         }}>
                             {selectedItem ? <ItemIcon item={selectedItem} size={40} /> : <span style={{color:'#666'}}>?</span>}
                         </div>
                         
                         <div className="d-flex flex-column justify-content-center gap-1">
                             <input type="text" className="form-control form-control-sm bg-secondary text-white border-0" 
                                placeholder="搜索物品..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} 
                                style={{width:'220px'}}/>
                         </div>

                         <div className="d-flex align-items-center gap-2 border-start border-secondary ps-3 ms-2">
                             <span className="text-light small">目标:</span>
                             <input type="number" className="form-control form-control-sm bg-secondary text-white border-0" style={{width: '80px', textAlign:'center'}}
                                value={amount} onChange={e => setAmount(Number(e.target.value))} />
                             <span className="text-light small">个/分钟</span>
                         </div>
                         
                         <div className="ms-auto">
                            <button className={`btn ${selectedItem ? 'btn-success' : 'btn-secondary disabled'}`} 
                                onClick={() => {if(selectedItem) onConfirm(selectedItem, amount);}}>
                                确认添加
                            </button>
                         </div>
                    </div>

                    <div className="fp-item-grid-wrapper" style={{
                        flexGrow: 1, 
                        overflow: 'auto', 
                        background: '#222', 
                        borderRadius: '4px', 
                        border: '1px solid #333', 
                        display: 'flex', 
                        justifyContent: 'center'
                    }}>
                        <div className="fp-item-grid-container" style={{
                            display: "grid",
                            gridTemplateColumns: `repeat(${icon_grid?.ncol || 10}, 42px)`,
                            gridTemplateRows: `repeat(${icon_grid?.nrow || 10}, 42px)`,
                            gap: '2px',
                            padding: '10px',
                            alignContent: 'start'
                        }}>
                            {doms}
                        </div>
                    </div>
                </div>
            </div>
        </div>, document.body
    );
}
