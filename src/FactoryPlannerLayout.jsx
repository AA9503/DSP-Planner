import {useContext, useState, useMemo} from 'react';
import '../css/FactoryPlanner.scss';
import {ItemIcon} from './icon.jsx';
import {Recipe} from './recipe.jsx'; 
import {GlobalStateContext, GameInfoContext, GameInfoSetterContext, SchemeDataSetterContext, SettingsSetterContext} from './contexts';
import {createPortal} from 'react-dom';
import {game_data_info_list, get_game_data, get_mod_options, vanilla_game_version} from "./GameData.jsx";
import {init_scheme_data} from './scheme_data.jsx';
import {Select} from "antd";

// --- MATH HELPERS ---

/**
 * Matrix Solver based on Factory Planner algorithm
 * Key insight: Add "pseudo-recipes" for free variables to make matrix square
 * 
 * Item Categories:
 * - Raw Inputs: consumed but not produced -> Free Variable (add pseudo-recipe)
 * - Byproducts: produced but not consumed (and not target) -> Free Variable
 * - Intermediate: both produced and consumed -> Constrained (net = 0) unless user marks as free
 * - Target: user-specified output
 */

function solveFactoryMatrix(rows, products, userFreeItems = new Set()) {
    if (rows.length === 0) {
        return { 
            solution: [], 
            freeVarAmounts: new Map(), 
            rawInputs: [], 
            byproducts: [], 
            intermediates: [],
            constrainedItems: [],
            error: null
        };
    }
    
    // 1. Collect all items and classify them
    const itemInfo = new Map(); // item -> { produced: bool, consumed: bool, target: number }
    
    products.forEach(p => {
        if (!itemInfo.has(p.name)) itemInfo.set(p.name, { produced: false, consumed: false, target: 0 });
        itemInfo.get(p.name).target += p.count;
    });
    
    rows.forEach(r => {
        Object.keys(r.recipeObj.产物 || {}).forEach(item => {
            if (!itemInfo.has(item)) itemInfo.set(item, { produced: false, consumed: false, target: 0 });
            itemInfo.get(item).produced = true;
        });
        Object.keys(r.recipeObj.原料 || {}).forEach(item => {
            if (!itemInfo.has(item)) itemInfo.set(item, { produced: false, consumed: false, target: 0 });
            itemInfo.get(item).consumed = true;
        });
    });
    
    // 2. Classify items
    const rawInputs = [];      // Consumed but not produced -> always free
    const byproducts = [];     // Produced but not consumed (and not target) -> always free
    const intermediates = [];  // Both produced and consumed -> constrained by default
    const targets = [];        // Has target > 0
    
    itemInfo.forEach((info, item) => {
        if (info.target > 0) {
            targets.push(item);
        }
        if (info.produced && info.consumed) {
            intermediates.push(item);
        } else if (!info.produced && info.consumed) {
            rawInputs.push(item);
        } else if (info.produced && !info.consumed && info.target === 0) {
            byproducts.push(item);
        }
    });
    
    // 3. Determine free variables
    // By default: rawInputs and byproducts are free
    // User can mark intermediates as free to resolve conflicts
    const autoFreeVars = new Set([...rawInputs, ...byproducts]);
    const allFreeVars = new Set([...autoFreeVars, ...userFreeItems]);
    
    // Constrained items: intermediates NOT marked as free by user
    const constrainedIntermediates = intermediates.filter(i => !userFreeItems.has(i));
    
    // All row items: first constrained (intermediates + targets), then free vars
    const constrainedItems = [...constrainedIntermediates, ...targets];
    const freeVarList = Array.from(allFreeVars);
    const allItems = [...constrainedItems, ...freeVarList];
    
    const numRecipes = rows.length;
    const numFreeVars = freeVarList.length;
    const numCols = numRecipes + numFreeVars;
    const numRows = allItems.length;
    
    // 4. Build augmented matrix [A | b]
    const M = Array(numRows).fill(0).map(() => Array(numCols + 1).fill(0));
    
    // Fill recipe columns
    allItems.forEach((item, rowIdx) => {
        rows.forEach((row, colIdx) => {
            const recipe = row.recipeObj;
            let rate = 0;
            if (recipe.产物 && recipe.产物[item]) rate += Number(recipe.产物[item]);
            if (recipe.原料 && recipe.原料[item]) rate -= Number(recipe.原料[item]);
            if (rate !== 0) {
                M[rowIdx][colIdx] = (rate / recipe.时间) * 60;
            }
        });
    });
    
    // Fill pseudo-recipe columns (identity matrix for free vars)
    freeVarList.forEach((item, freeIdx) => {
        const rowIdx = allItems.indexOf(item);
        if (rowIdx >= 0) {
            M[rowIdx][numRecipes + freeIdx] = 1;
        }
    });
    
    // Fill RHS (target amounts)
    allItems.forEach((item, rowIdx) => {
        const info = itemInfo.get(item);
        if (info && info.target > 0) {
            M[rowIdx][numCols] = info.target;
        }
    });
    
    // 5. Solve
    const result = gaussJordanSolve(M, numRows, numCols);
    
    // 6. Check for errors
    if (result.inconsistentRows.length > 0) {
        // Find which constrained items are causing issues
        const problemItems = result.inconsistentRows
            .filter(r => r < constrainedItems.length)
            .map(r => constrainedItems[r]);
        
        return {
            solution: null,
            freeVarAmounts: new Map(),
            rawInputs, byproducts, intermediates, constrainedItems,
            error: {
                type: 'inconsistent',
                message: '系统矛盾：某些中间产物的产量和消耗量无法平衡',
                problemItems,
                suggestion: problemItems.length > 0 
                    ? `建议将 "${problemItems[0]}" 设为自由变量（允许外部输入/输出）`
                    : '请检查配方是否有冲突'
            }
        };
    }
    
    if (result.dependentCols.length > 0) {
        // Find which recipes are dependent
        const dependentRecipes = result.dependentCols
            .filter(c => c < numRecipes)
            .map(c => rows[c].recipeObj);
        
        return {
            solution: null,
            freeVarAmounts: new Map(),
            rawInputs, byproducts, intermediates, constrainedItems,
            error: {
                type: 'dependent',
                message: '检测到线性相关：存在冗余配方',
                dependentRecipes,
                suggestion: '请删除冗余配方，或将某个中间产物设为自由变量'
            }
        };
    }
    
    // 7. Extract solution
    const recipeCounts = [];
    for (let i = 0; i < numRecipes; i++) {
        recipeCounts.push(result.solution[i] || 0);
    }
    
    const freeVarAmounts = new Map();
    freeVarList.forEach((item, idx) => {
        const amount = result.solution[numRecipes + idx] || 0;
        freeVarAmounts.set(item, amount);
    });
    
    return { 
        solution: recipeCounts, 
        freeVarAmounts, 
        rawInputs, 
        byproducts, 
        intermediates,
        constrainedItems,
        error: null
    };
}

function gaussJordanSolve(M, numRows, numCols) {
    const matrix = M.map(row => [...row]);
    const pivotCols = [];
    let pivotRow = 0;
    
    for (let col = 0; col < numCols && pivotRow < numRows; col++) {
        let maxVal = Math.abs(matrix[pivotRow][col]);
        let maxRow = pivotRow;
        
        for (let row = pivotRow + 1; row < numRows; row++) {
            if (Math.abs(matrix[row][col]) > maxVal) {
                maxVal = Math.abs(matrix[row][col]);
                maxRow = row;
            }
        }
        
        if (maxVal < 1e-10) continue;
        
        [matrix[pivotRow], matrix[maxRow]] = [matrix[maxRow], matrix[pivotRow]];
        
        const pivot = matrix[pivotRow][col];
        for (let j = col; j <= numCols; j++) {
            matrix[pivotRow][j] /= pivot;
        }
        
        for (let row = 0; row < numRows; row++) {
            if (row !== pivotRow && Math.abs(matrix[row][col]) > 1e-10) {
                const factor = matrix[row][col];
                for (let j = col; j <= numCols; j++) {
                    matrix[row][j] -= factor * matrix[pivotRow][j];
                }
            }
        }
        
        pivotCols.push(col);
        pivotRow++;
    }
    
    // Check for dependent columns (non-pivot columns within the recipe range)
    const dependentCols = [];
    for (let col = 0; col < numCols; col++) {
        if (!pivotCols.includes(col)) {
            dependentCols.push(col);
        }
    }
    
    // Check for inconsistent rows [0 0 ... 0 | c] where c != 0
    const inconsistentRows = [];
    for (let row = 0; row < numRows; row++) {
        let allZero = true;
        for (let col = 0; col < numCols; col++) {
            if (Math.abs(matrix[row][col]) > 1e-9) {
                allZero = false;
                break;
            }
        }
        if (allZero && Math.abs(matrix[row][numCols]) > 1e-6) {
            inconsistentRows.push(row);
        }
    }
    
    // Extract solution
    const solution = new Array(numCols).fill(0);
    for (let i = 0; i < pivotCols.length; i++) {
        solution[pivotCols[i]] = matrix[i][numCols];
    }
    
    return { 
        solution: solution.map(v => Math.abs(v) < 1e-6 ? 0 : v),
        dependentCols,
        inconsistentRows
    };
}

// Helper to format numbers like 1000 -> 1k
function formatCount(num) {
    if (num === undefined || num === null) return "";
    const abs = Math.abs(num);
    if (abs < 1000) return Number(num.toFixed(1)).toString();
    if (abs < 1000000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + "k";
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + "m";
}

function IconSlot({ item, count, type = "default", onClick, onContextMenu, className="" }) {
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

// Popover for editing Top Product
function ProductEditPopover({ isOpen, onClose, product, position, onDelete, onUpdate, onAddRecipe }) {
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

// Enhanced Modal for Adding Top Product with Grid Support
function AddProductModal({ isOpen, onClose, onConfirm }) {
    const game_info = useContext(GameInfoContext);
    const [selectedItem, setSelectedItem] = useState(null);
    const [amount, setAmount] = useState(60);
    const [searchTerm, setSearchTerm] = useState("");

    if (!isOpen) return null;
    
    const icon_grid = game_info.icon_grid;
    // We filter based on searchTerm
    // For grid display, we can just dim non-matching items or hide them.
    // Let's hide them for cleaner look, or re-render grid.
    
    // The original grid system lays out items by row/col manually.
    // If we want to use the original layout, we render them in grid.
    
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
                             <span className="text-muted small">目标:</span>
                             <input type="number" className="form-control form-control-sm bg-secondary text-white border-0" style={{width: '80px', textAlign:'center'}}
                                value={amount} onChange={e => setAmount(Number(e.target.value))} />
                             <span className="text-muted small">/min</span>
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

function RecipeSelectorModal({ isOpen, onClose, item, gameData, mode, onSelect }) {
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

export function FactoryPlannerLayout() {
    const global_state = useContext(GlobalStateContext);
    const game_data = global_state?.game_data;
    
    // Mod selection state
    const set_game_data = useContext(GameInfoSetterContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    const set_settings = useContext(SettingsSetterContext);
    const [mods, setMods] = useState([]);
    const mod_options = get_mod_options();

    // View State
    const [plans, setPlans] = useState([{
        id: 1,
        name: '新方案',
        products: [],
        productionRows: [],
        userFreeItems: new Set()
    }]);
    const [activePlanId, setActivePlanId] = useState(1);
    
    const activePlan = useMemo(() => plans.find(p => p.id === activePlanId), [plans, activePlanId]);
    const products = useMemo(() => activePlan?.products || [], [activePlan]);
    const productionRows = useMemo(() => activePlan?.productionRows || [], [activePlan]);
    const userFreeItems = useMemo(() => activePlan?.userFreeItems || new Set(), [activePlan]);
    
    const setProducts = (newProducts) => {
        setPlans(prev => prev.map(plan => 
            plan.id === activePlanId 
                ? { ...plan, products: typeof newProducts === 'function' ? newProducts(plan.products) : newProducts }
                : plan
        ));
    };
    
    const setProductionRows = (newRows) => {
        setPlans(prev => prev.map(plan => 
            plan.id === activePlanId 
                ? { ...plan, productionRows: typeof newRows === 'function' ? newRows(plan.productionRows) : newRows }
                : plan
        ));
    };
    
    const setUserFreeItems = (newItems) => {
        setPlans(prev => prev.map(plan => 
            plan.id === activePlanId 
                ? { ...plan, userFreeItems: typeof newItems === 'function' ? newItems(plan.userFreeItems) : newItems }
                : plan
        ));
    };
    
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [pendingNewPlan, setPendingNewPlan] = useState(false); // 标记是否正在创建新方案
    const [recipeSelector, setRecipeSelector] = useState({ isOpen: false, item: null, mode: 'produce' });
    const [popoverState, setPopoverState] = useState({ isOpen: false, product: null, position: {x:0, y:0} });

    // Plan management functions
    const handleAddNewPlan = () => {
        // 打开添加产物窗口，同时标记正在创建新方案
        setPendingNewPlan(true);
        setIsAddModalOpen(true);
    };
    
    const handleSwitchPlan = (planId) => {
        setActivePlanId(planId);
    };
    
    const handleDeletePlan = (planId) => {
        if (plans.length <= 1) {
            alert('至少需要保留一个方案');
            return;
        }
        const remainingPlans = plans.filter(p => p.id !== planId);
        setPlans(remainingPlans);
        if (activePlanId === planId) {
            setActivePlanId(remainingPlans[0].id);
        }
    };

    // Mod change handler (adapted from App.jsx GameVersion component)
    const handleModsChange = async (modList) => {
        if (products.length > 0 || productionRows.length > 0) {
            if (!confirm(`检测到规划器内有配方，确认继续切换mod吗？切换后将清空规划！`)) {
                return;
            }
            setProducts([]);
            setProductionRows([]);
            setUserFreeItems(new Set());
        }

        // Dependency logic from App.jsx
        let MSGUID = game_data_info_list[1].name_en + game_data_info_list[1].version;
        let VDGUID = game_data_info_list[2].name_en + game_data_info_list[2].version;
        let ms_old = mods.includes(MSGUID);
        let vd_old = mods.includes(VDGUID);
        let ms_new = modList.includes(MSGUID);
        let vd_new = modList.includes(VDGUID);
        if (!ms_old && !vd_old && !ms_new && vd_new) modList.push(MSGUID);
        if (ms_old && vd_old && !ms_new && vd_new) modList = modList.filter((mod) => mod !== VDGUID);

        let GBGUID = game_data_info_list[3].name_en + game_data_info_list[3].version;
        let gb_old = mods.includes(GBGUID);
        let gb_new = modList.includes(GBGUID);
        let ORGUID = game_data_info_list[4].name_en + game_data_info_list[4].version;
        let or_old = mods.includes(ORGUID);
        let or_new = modList.includes(ORGUID);
        if (!gb_old && gb_new && or_old) modList = modList.filter((mod) => mod !== ORGUID);
        if (!or_old && or_new && gb_old) modList = modList.filter((mod) => mod !== GBGUID);
        if (!vd_old && vd_new && or_old) modList = modList.filter((mod) => mod !== ORGUID);
        if (!or_old && or_new && vd_old) modList = modList.filter((mod) => mod !== VDGUID);

        let modList2 = [];
        game_data_info_list.forEach((mod_info) => {
            for (let i = 0; i < modList.length; i++) {
                if (modList[i] === mod_info.name_en + mod_info.version) {
                    modList2.push(modList[i]);
                }
            }
        });
        if (JSON.stringify(modList2) === JSON.stringify(mods)) return;
        
        setMods(modList2);
        let new_game_data = get_game_data(modList2);
        set_game_data(new_game_data);
        set_scheme_data(init_scheme_data(new_game_data));

        // Set default mining speeds based on mod
        if (new_game_data.GenesisBookEnable) {
            set_settings({"mining_speed_oil": 3.0});
            set_settings({"mining_speed_hydrogen": 1.0});
        } else if (new_game_data.OrbitalRingEnable) {
            set_settings({"mining_speed_oil": 3.0});
            set_settings({"mining_speed_water": 3.0});
        } else {
            set_settings({"mining_speed_oil": 3.0});
        }
    };

    // --- MATRIX CALCULATOR ---
    const { solvedRows, netIngredients, netByproducts, netStatusMap, solverError, intermediates } = useMemo(() => {
        // Setup - preserve isByproductConsumer from original row data (user intent)
        const rows = productionRows.map(r => ({ 
            ...r, 
            factoryCount: 0, 
            inputs: [], 
            outputs: [], 
            mainProducts: [], 
            byproducts: [], 
            catalysts: [],
            // Preserve isByproductConsumer from original data, default to false
            isByproductConsumer: r.isByproductConsumer || false
        }));
        if (rows.length === 0 && products.length === 0) 
            return { solvedRows: [], netIngredients: [], netByproducts: [], netStatusMap: new Map(), solverError: null, intermediates: [] };

        // Use factory matrix solver with user-specified free items
        const result = solveFactoryMatrix(rows, products, userFreeItems);
        
        console.log("=== Factory Matrix Solver ===");
        console.log("Raw Inputs:", result.rawInputs);
        console.log("Byproducts:", result.byproducts);
        console.log("Intermediates:", result.intermediates);
        console.log("User Free Items:", [...userFreeItems]);
        console.log("Solution:", result.solution);
        console.log("Free Var Amounts:", result.freeVarAmounts);
        if (result.error) console.log("Error:", result.error);
        
        // Apply Solution - First pass: calculate rates and detect catalysts
        const totalNetMap = new Map();
        products.forEach(p => totalNetMap.set(p.name, (totalNetMap.get(p.name)||0) - p.count));
        const targetNames = new Set(products.map(p => p.name));

        // Collect all items consumed by any recipe (as ingredients)
        const allConsumedItems = new Set();
        rows.forEach(row => {
            Object.keys(row.recipeObj.原料 || {}).forEach(item => allConsumedItems.add(item));
        });

        rows.forEach((row, idx) => {
            const count = result.solution ? (result.solution[idx] || 0) : 0;
            row.factoryCount = count.toFixed(2);
            
            // Detect catalysts: items that appear in both inputs and outputs with same amount
            const inputAmounts = row.recipeObj.原料 || {};
            const outputAmounts = row.recipeObj.产物 || {};
            const catalysts = [];
            
            Object.keys(outputAmounts).forEach(item => {
                if (inputAmounts[item] && inputAmounts[item] === outputAmounts[item]) {
                    catalysts.push(item);
                }
            });
            row.catalysts = catalysts;
            
            // Calculate input/output rates
            Object.entries(outputAmounts).forEach(([item, amount]) => {
                const rate = amount * (count / row.recipeObj.时间) * 60;
                row.outputs.push({ name: item, count: rate });
                totalNetMap.set(item, (totalNetMap.get(item)||0) + rate);
            });
            
            Object.entries(inputAmounts).forEach(([item, amount]) => {
                const rate = amount * (count / row.recipeObj.时间) * 60;
                row.inputs.push({ name: item, count: rate });
                totalNetMap.set(item, (totalNetMap.get(item)||0) - rate);
            });
        });

        // Second pass: Classify products vs byproducts with complex rules
        // Rule 1: Target products are always "products"
        // Rule 2: First output of a recipe is usually the "main product"
        // Rule 3: If an output is consumed by another recipe, it becomes a "product"
        // Rule 4: Byproduct consumer recipe is determined by user intent (from row.isByproductConsumer)
        // Rule 5: Outputs of byproduct consumer recipes are still byproducts unless consumed elsewhere

        // Now classify each row's outputs
        rows.forEach((row) => {
            const outputAmounts = row.recipeObj.产物 || {};
            const allOutputItems = Object.keys(outputAmounts);
            
            // isByproductConsumer is already set from productionRows (user intent when adding)
            // We preserve it from the original row data
            
            row.mainProducts = [];
            row.byproducts = [];
            
            allOutputItems.forEach((item) => {
                const itemObj = row.outputs.find(o => o.name === item);
                if (!itemObj) return;
                
                const isCatalyst = row.catalysts.includes(item);
                const isTarget = targetNames.has(item);
                const isConsumedElsewhere = allConsumedItems.has(item);
                
                // 规则1: 催化剂 → 产物（特殊情况）
                // 规则2: 用户目标 → 产物
                // 规则3: 被其他配方消耗 → 产物
                // 其他所有 → 副产物（包括消解配方的产出，除非被规则3覆盖）
                
                if (isCatalyst) {
                    // 催化剂显示在产物列（有特殊样式）
                    row.mainProducts.push(itemObj);
                } else if (isTarget) {
                    // 用户的目标产物 → 产物
                    row.mainProducts.push(itemObj);
                } else if (isConsumedElsewhere) {
                    // 被其他配方作为原料使用 → 产物
                    row.mainProducts.push(itemObj);
                } else {
                    // 其他所有 → 副产物
                    row.byproducts.push(itemObj);
                }
            });
        });

        // Generate Summary using freeVarAmounts
        const netIng = [];
        const netBy = [];
        
        if (result.freeVarAmounts) {
            result.freeVarAmounts.forEach((amount, item) => {
                if (amount > 0.01) {
                    netIng.push({ name: item, count: amount });
                } else if (amount < -0.01) {
                    netBy.push({ name: item, count: -amount });
                }
            });
        }
        
        return { 
            solvedRows: rows, 
            netIngredients: netIng, 
            netByproducts: netBy, 
            netStatusMap: totalNetMap,
            solverError: result.error,
            intermediates: result.intermediates || []
        };
    }, [products, productionRows, userFreeItems]);

    // Handler to toggle free variable
    const toggleFreeItem = (item) => {
        setUserFreeItems(prev => {
            const next = new Set(prev);
            if (next.has(item)) {
                next.delete(item);
            } else {
                next.add(item);
            }
            return next;
        });
    };


    // Handlers
    const handleAddProduct = (item, count) => {
        if (pendingNewPlan) {
            // 创建新方案并添加产物
            const newId = Math.max(...plans.map(p => p.id)) + 1;
            const newProduct = { id: Date.now(), name: item, count };
            setPlans(prev => [...prev, {
                id: newId,
                name: item, // 用产物名作为方案名
                products: [newProduct],
                productionRows: [],
                userFreeItems: new Set()
            }]);
            setActivePlanId(newId);
            setPendingNewPlan(false);
        } else {
            // 正常添加到当前方案
            setProducts([...products, { id: Date.now(), name: item, count: count }]);
            // 更新方案名（如果是第一个产物）
            if (products.length === 0) {
                setPlans(prev => prev.map(plan => 
                    plan.id === activePlanId ? { ...plan, name: item } : plan
                ));
            }
        }
        setIsAddModalOpen(false);
    }
    const handleDeleteProduct = (id) => {
        setProducts(products.filter(p => p.id !== id));
        setPopoverState({...popoverState, isOpen: false});
    }
    const handleUpdateProduct = (id, newCount) => {
        setProducts(products.map(p => p.id === id ? {...p, count: newCount} : p));
    }
    const handleDeleteRow = (id) => {
        setProductionRows(productionRows.filter(r => r.id !== id));
    }
    const handleSelectRecipe = (recipe) => {
        const exists = productionRows.find(r => r.recipeObj === recipe); 
        if (!exists) {
            // Mark as byproduct consumer if we're in 'consume' mode (clicked from byproduct)
            const isByproductConsumer = recipeSelector.mode === 'consume';
            setProductionRows([...productionRows, { 
                id: Date.now(), 
                recipeObj: recipe,
                isByproductConsumer: isByproductConsumer
            }]);
        }
        setRecipeSelector({...recipeSelector, isOpen: false});
    }

    const handleSmartClick = (item) => {
        setRecipeSelector({ isOpen: true, item: item, mode: 'produce' });
    }
    const handleConsumeClick = (item) => {
        setRecipeSelector({ isOpen: true, item: item, mode: 'consume' });
    }

    return (
        <div className="fp-container" style={{ 
            flexDirection: 'column',
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100
        }}>
            {/* Top Toolbar */}
            <div className="fp-toolbar" style={{
                height: '44px',
                minHeight: '44px',
                background: 'linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%)',
                borderBottom: '1px solid #444',
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                gap: '16px'
            }}>
                <span style={{ color: '#fa9d00', fontWeight: 'bold', fontSize: '14px' }}>DSP Planner</span>
                <span style={{ color: '#888', fontSize: '12px' }}>v{vanilla_game_version}</span>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '16px' }}>
                    <span style={{ color: '#aaa', fontSize: '13px' }}>模组选择</span>
                    <Select 
                        style={{ minWidth: 280 }} 
                        mode="multiple" 
                        options={mod_options} 
                        value={mods} 
                        onChange={handleModsChange}
                        placeholder="选择模组..."
                        size="small"
                    />
                </div>
                
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ color: '#888', fontSize: '12px' }}>
                        {productionRows.length} 配方 | {products.length} 目标
                    </span>
                </div>
            </div>

            {/* Modals */}
            <AddProductModal 
                isOpen={isAddModalOpen} 
                onClose={() => { setIsAddModalOpen(false); setPendingNewPlan(false); }}
                onConfirm={handleAddProduct}
            />
            <ProductEditPopover 
                isOpen={popoverState.isOpen}
                onClose={() => setPopoverState({...popoverState, isOpen:false})}
                product={popoverState.product}
                position={popoverState.position}
                onDelete={handleDeleteProduct}
                onUpdate={handleUpdateProduct}
                onAddRecipe={(p) => setRecipeSelector({ isOpen: true, item: p.name, mode: 'produce' })}
            />
            <RecipeSelectorModal 
                isOpen={recipeSelector.isOpen}
                onClose={() => setRecipeSelector({...recipeSelector, isOpen: false})}
                item={recipeSelector.item}
                gameData={game_data}
                mode={recipeSelector.mode}
                onSelect={handleSelectRecipe}
            />

            {/* Content Area with Sidebar */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Sidebar */}
                <div className="fp-sidebar">
                    <div className="sidebar-header">
                        <span>生产策略</span>
                        <button className="btn btn-outline-secondary btn-sm" title="新建方案" onClick={handleAddNewPlan}>+</button>
                    </div>
                    <div className="sidebar-content">
                        {plans.map(plan => (
                            <div 
                                key={plan.id}
                                className={`plan-item ${plan.id === activePlanId ? 'active' : ''}`}
                                onClick={() => handleSwitchPlan(plan.id)}
                            >
                                <div className="plan-icon-wrapper">
                                    {plan.products.length > 0 ? (
                                        <IconSlot item={plan.products[0].name} type="product" />
                                    ) : (
                                        <div className="icon-placeholder"></div>
                                    )}
                                </div>
                                <span className="plan-name">{plan.name}</span>
                                {plans.length > 1 && (
                                    <button 
                                        className="btn-delete"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeletePlan(plan.id);
                                        }}
                                        title="删除方案"
                                    >×</button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right side: Main + Status Bar */}
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

                    {/* Main Content Area */}
                    <div className="fp-main" style={{ flex: 1, overflow: 'hidden' }}>
                        {/* Summary Panel */}
                        <div className="fp-summary-panel">
                        <div className="fp-summary-box">
                            <h4>目标产物</h4>
                            <div className="box-content">
                                {products.map(p => {
                                    const balance = netStatusMap.get(p.name) || 0;
                                    const isSat = balance >= -0.01;
                                    return <IconSlot key={p.id} item={p.name} count={p.count} type={isSat ? "product-satisfied" : "product-unplanned"}
                                        className="cursor-pointer" onClick={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            setPopoverState({ isOpen: true, product: p, position: { x: rect.left + rect.width/2, y: rect.bottom } });
                                        }} />
                                })}
                                <button className="btn btn-sm btn-secondary d-flex align-items-center justify-content-center" style={{height:'44px', width:'44px', margin:'2px', background:'#484848', border:'1px solid #111'}} onClick={() => setIsAddModalOpen(true)}><span style={{fontSize:'24px', color:'#aaa', lineHeight:1}}>+</span></button>
                            </div>
                        </div>
                        <div className="fp-summary-box">
                            <h4>副产物</h4>
                            <div className="box-content">{netByproducts.map((p,i) => <IconSlot key={i} item={p.name} count={p.count} onClick={()=>handleConsumeClick(p.name)} />)}</div>
                        </div>
                        <div className="fp-summary-box" style={{flex: 1.5}}>
                            <h4>原料输入</h4>
                            <div className="box-content">{netIngredients.map((p,i) => <IconSlot key={i} item={p.name} count={p.count} type="ingredient" onClick={()=>handleSmartClick(p.name)} />)}</div>
                        </div>
                    </div>

                    {/* Recipe Table */}
                    <div className="fp-table-area">
                        {solvedRows.length === 0 && products.length === 0 ? <div className="empty-state">请添加目标产物开始规划</div> : 
                            <table className="table-dark">
                                <thead><tr><th style={{width:'30px'}}></th><th>配方</th><th>工厂</th><th>能耗</th><th>产物</th><th>副产物</th><th>原料</th></tr></thead>
                                <tbody>
                                    {solvedRows.map(row => {
                                        return (
                                            <tr key={row.id} style={{borderTop: '1px solid #444', background: row.isByproductConsumer ? 'rgba(100, 80, 60, 0.3)' : 'transparent'}}>
                                                <td className="text-center"><button className="btn btn-link text-danger p-0 text-decoration-none" style={{fontSize: '20px', lineHeight: 1}} onClick={() => handleDeleteRow(row.id)}>&times;</button></td>
                                                <td>
                                                    <div className="d-flex align-items-center gap-2">
                                                        <Recipe recipe={row.recipeObj} />
                                                        {row.isByproductConsumer && (
                                                            <span style={{
                                                                fontSize: '10px', 
                                                                color: '#c9a66b', 
                                                                background: 'rgba(100, 80, 60, 0.5)',
                                                                padding: '2px 6px',
                                                                borderRadius: '3px',
                                                                whiteSpace: 'nowrap'
                                                            }}>消耗副产物</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td><div className="d-flex align-items-center gap-2"><IconSlot item={row.recipeObj["设施"]} count={Number(row.factoryCount)} type="factory" /><span>x{row.factoryCount}</span></div></td>
                                                <td>{row.power}</td>
                                                <td><div className="d-flex gap-1">{row.mainProducts.map(p => {
                                                     const isCatalyst = row.catalysts?.includes(p.name);
                                                     return <IconSlot key={p.name} item={p.name} count={p.count} type={isCatalyst ? "catalyst" : "product"} className="cursor-default" />
                                                })}</div></td>
                                                <td><div className="d-flex gap-1">{row.byproducts.map(p => {
                                                     return <IconSlot key={p.name} item={p.name} count={p.count} type="byproduct" onClick={() => handleConsumeClick(p.name)} />
                                                })}</div></td> 
                                                <td><div className="d-flex gap-1">{row.inputs.map(p => {
                                                     const isSat = (netStatusMap.get(p.name) || 0) >= -0.01;
                                                     const isCatalyst = row.catalysts?.includes(p.name);
                                                     return <IconSlot key={p.name} item={p.name} count={p.count} type={isCatalyst ? "catalyst" : (isSat?"product-satisfied":"product-unplanned")} onClick={!isSat && !isCatalyst ?()=>handleSmartClick(p.name):undefined} />
                                                })}</div></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        }
                    </div>
                    </div>

                    {/* Bottom Status Bar - inside the right column */}
                    <div className="fp-statusbar" style={{
                        minHeight: '36px',
                        background: 'linear-gradient(180deg, #2a2a2a 0%, #222 100%)',
                        borderTop: '1px solid #444',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '4px 12px',
                        gap: '16px',
                        flexWrap: 'wrap'
                    }}>
                {/* Error Status */}
                {solverError && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ff6b6b' }}>
                        <span>⚠️</span>
                        <span style={{ fontSize: '12px' }}>{solverError.message}</span>
                        {solverError.problemItems && solverError.problemItems.map((item, i) => (
                            <div key={i} style={{ transform: 'scale(0.7)', marginLeft: '-4px' }}>
                                <IconSlot item={item} type="ingredient" />
                            </div>
                        ))}
                        {solverError.suggestion && (
                            <span style={{ fontSize: '11px', color: '#88cc88', marginLeft: '8px' }}>
                                💡 {solverError.suggestion}
                            </span>
                        )}
                    </div>
                )}
                
                {/* Intermediate Items */}
                {intermediates.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: solverError ? '16px' : '0' }}>
                        <span style={{ color: '#4a90d9', fontSize: '12px', fontWeight: 'bold' }}>中间产物:</span>
                        <span style={{ color: '#666', fontSize: '11px' }}>(点击设为自由变量)</span>
                        {intermediates.map((item, i) => {
                            const isFree = userFreeItems.has(item);
                            return (
                                <div 
                                    key={i} 
                                    onClick={() => toggleFreeItem(item)}
                                    style={{
                                        cursor: 'pointer',
                                        border: isFree ? '2px solid #88cc88' : '2px solid transparent',
                                        borderRadius: '4px',
                                        background: isFree ? 'rgba(136, 204, 136, 0.2)' : 'transparent',
                                        transform: 'scale(0.75)',
                                        marginLeft: '-6px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center'
                                    }}
                                    title={isFree ? '点击取消自由变量' : '点击设为自由变量'}
                                >
                                    <IconSlot item={item} type={isFree ? "product-satisfied" : "intermediate"} />
                                    {isFree && <div style={{ fontSize: '9px', color: '#88cc88', marginTop: '-4px' }}>自由</div>}
                                </div>
                            );
                        })}
                    </div>
                )}
                
                {/* Status text when no issues */}
                                {!solverError && intermediates.length === 0 && (
                    <span style={{ color: '#666', fontSize: '12px' }}>
                        {products.length === 0 ? '就绪 - 添加目标产物开始规划' : '✓ 矩阵求解完成'}
                    </span>
                )}
                    </div>
                </div>
            </div>
        </div>
    );
}