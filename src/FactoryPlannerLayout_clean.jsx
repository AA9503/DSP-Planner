
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
    // Plans state - each plan has its own products and production rows
    const [plans, setPlans] = useState([
        { 
            id: 1, 
            name: '新方�?, 
            products: [], 
            productionRows: [],
            userFreeItems: new Set()
        }
    ]);
    const [activePlanId, setActivePlanId] = useState(1);
    
    // Get active plan
    const activePlan = plans.find(p => p.id === activePlanId) || plans[0];
    const products = activePlan.products;
    const productionRows = activePlan.productionRows;
    const userFreeItems = activePlan.userFreeItems;
    
    // Update active plan
    const updateActivePlan = (updates) => {
        setPlans(plans.map(p => {
            if (p.id === activePlanId) {
                const updated = {...p, ...updates};
                // Auto-update plan name based on first product
                if (updates.products && updates.products.length > 0) {
                    updated.name = updates.products[0].name;
                } else if (updates.products && updates.products.length === 0) {
                    updated.name = '新方�?;
                }
                return updated;
            }
            return p;
        }));
    };
    
    const setProducts = (newProducts) => updateActivePlan({ products: newProducts });
    const setProductionRows = (newRows) => updateActivePlan({ productionRows: newRows });
    const setUserFreeItems = (newFreeItems) => updateActivePlan({ userFreeItems: newFreeItems });
    
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [recipeSelector, setRecipeSelector] = useState({ isOpen: false, item: null, mode: 'produce' });
    const [popoverState, setPopoverState] = useState({ isOpen: false, product: null, position: {x:0, y:0} });

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
                
                // 规则1: 催化�?�?产物（特殊情况）
                // 规则2: 用户目标 �?产物
                // 规则3: 被其他配方消�?�?产物
                // 其他所�?�?副产物（包括消解配方的产出，除非被规�?覆盖�?
                
                if (isCatalyst) {
                    // 催化剂显示在产物列（有特殊样式）
                    row.mainProducts.push(itemObj);
                } else if (isTarget) {
                    // 用户的目标产�?�?产物
                    row.mainProducts.push(itemObj);
                } else if (isConsumedElsewhere) {
                    // 被其他配方作为原料使�?�?产物
                    row.mainProducts.push(itemObj);
                } else {
                    // 其他所�?�?副产�?
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
        setProducts([...products, { id: Date.now(), name: item, count: count }]);
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
    
    // Plan management
    const handleAddNewPlan = () => {
        // Open add product modal for new plan
        const newPlanId = Date.now();
        setPlans([...plans, { 
            id: newPlanId, 
            name: '新方�?, 
            products: [], 
            productionRows: [],
            userFreeItems: new Set()
        }]);
        setActivePlanId(newPlanId);
        setIsAddModalOpen(true);
    };
    
    const handleSwitchPlan = (planId) => {
        setActivePlanId(planId);
    };
    
    const handleDeletePlan = (planId) => {
        if (plans.length <= 1) {
            alert('至少需要保留一个方�?);
            return;
        }
        if (!confirm('确认删除此方案？')) return;
        
        setPlans(plans.filter(p => p.id !== planId));
        if (activePlanId === planId) {
            setActivePlanId(plans.find(p => p.id !== planId).id);
        }
    };
    
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
                onClose={() => setIsAddModalOpen(false)}
                onConfirm={handleAddProduct}
            />
            <ProductEditPopover 
                isOpen={popoverState.isOpen}
                onClose={() => setPopoverState({...popoverState, isOpen:false})}
                product={popoverState.product ? products.find(p => p.id === popoverState.product.id) : null}
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
                        <button className="btn btn-outline-secondary btn-sm" onClick={handleAddNewPlan} title="新建方案">+</button>
                    </div>
                    <div className="sidebar-content">
                        {plans.map(plan => (
                            <div 
                                key={plan.id} 
                                className={`plan-item ${plan.id === activePlanId ? 'active' : ''}`}
                                onClick={() => handleSwitchPlan(plan.id)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    handleDeletePlan(plan.id);
                                }}
                                title="右键删除"
                            >
                                {plan.products.length > 0 ? (
                                    <IconSlot item={plan.products[0].name} type="product" />
                                ) : (
                                    <div className="icon-placeholder"></div>
                                )}
                                <span>{plan.name}</span>
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
                            <h4>副产�?/h4>
                            <div className="box-content">{netByproducts.map((p,i) => <IconSlot key={i} item={p.name} count={p.count} onClick={()=>handleConsumeClick(p.name)} />)}</div>
                        </div>
                        <div className="fp-summary-box" style={{flex: 1.5}}>
                            <h4>原料输入</h4>
                            <div className="box-content">{netIngredients.map((p,i) => <IconSlot key={i} item={p.name} count={p.count} type="ingredient" onClick={()=>handleSmartClick(p.name)} />)}</div>
                        </div>
                    </div>

                    {/* Recipe Table */}
                    <div className="fp-table-area">
                        {solvedRows.length === 0 && products.length === 0 ? <div className="empty-state">请添加目标产物开始规�?/div> : 
                            <table className="table-dark">
                                <thead><tr><th style={{width:'30px'}}></th><th>配方</th><th>工厂</th><th>能�?/th><th>产物</th><th>副产�?/th><th>原料</th></tr></thead>
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
                        {products.length === 0 ? '就绪 - 添加目标产物开始规�? : '�?矩阵求解完成'}
                    </span>
                )}
                    </div>
                </div>
            </div>
        </div>
    );
}
