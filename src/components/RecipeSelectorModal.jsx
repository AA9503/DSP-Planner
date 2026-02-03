import {createPortal} from 'react-dom';
import {Recipe} from '../recipe.jsx';

export function RecipeSelectorModal({ isOpen, onClose, item, gameData, mode, onSelect }) {
    if (!isOpen || !item) return null;
    let possibleRecipes = [];
    if (mode === "produce" || !mode) possibleRecipes = gameData?.recipe_data.filter(r => r.产物 && r.产物[item]) || [];
    else if (mode === "consume") possibleRecipes = gameData?.recipe_data.filter(r => r.原料 && r.原料[item]) || [];
    
    return createPortal(
        <div className="fp-modal-overlay" onClick={onClose}>
            <div className="fp-modal" onClick={e => e.stopPropagation()} style={{width: '600px'}}>
                <div className="fp-modal-header">
                    <span>{mode === 'consume' ? '消耗副产物' : '生产原料'}: {item}</span>
                    <button className="btn-close btn-close-white" onClick={onClose}></button>
                </div>
                <div className="fp-modal-body">
                    {possibleRecipes.length === 0 ? <div className="text-muted">没有找到相关配方。</div> : 
                        <div className="d-flex flex-column gap-2">
                            {possibleRecipes.map((r, idx) => (
                                <div key={idx} className="p-2 border border-secondary rounded recipe-select-item cursor-pointer d-flex align-items-center justify-content-between"
                                    style={{backgroundColor: '#333', cursor: 'pointer'}} onClick={() => onSelect(r)}>
                                    <div style={{color: '#eee'}}><Recipe recipe={r} /></div>
                                    <button className="btn btn-sm btn-outline-primary">选择</button>
                                </div>
                            ))}
                        </div>
                    }
                </div>
            </div>
        </div>, document.body
    );
}
