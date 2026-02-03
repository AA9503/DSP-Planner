import {ItemIcon} from '../icon.jsx';

// Helper to format numbers like 1000 -> 1k
function formatCount(num) {
    if (num === undefined || num === null) return "";
    const abs = Math.abs(num);
    if (abs < 1000) return Number(num.toFixed(1)).toString();
    if (abs < 1000000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + "k";
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + "m";
}

export function IconSlot({ item, count, type = "default", onClick, onContextMenu, className="" }) {
    let slotClass = "fp-icon-slot";
    if (type.includes("product")) slotClass += " product-slot";
    if (type.includes("ingredient")) slotClass += " ingredient-slot";
    if (type.includes("unplanned")) slotClass += " product-slot-unplanned";
    if (type.includes("satisfied")) {
         // Override red/grey with green
         slotClass = slotClass.replace("product-slot-unplanned", "").replace("ingredient-slot", "") + " product-slot"; 
    }
    if (type === "factory") slotClass += " factory-slot";
    if (type === "catalyst") slotClass += " catalyst-slot";
    if (type === "byproduct") slotClass += " byproduct-slot";
    if (className) slotClass += " " + className;

    return (
        <div 
            className={slotClass} 
            title={`${item}${count ? ': ' + count : ''}`} 
            onClick={onClick}
            onContextMenu={onContextMenu}
        >
             <div style={{pointerEvents: 'none'}}>
                <ItemIcon item={item} size={32} tooltip={false} />
             </div>
             {count !== undefined && (
                <span className="icon-overlay-text">{formatCount(count)}</span>
             )}
        </div>
    );
}
