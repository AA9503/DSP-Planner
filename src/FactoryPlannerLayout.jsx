import {useContext, useState, useMemo, useEffect} from 'react';
import '../css/FactoryPlanner.scss';
import {Recipe} from './recipe.jsx'; 
import {GlobalStateContext, GameInfoSetterContext, SchemeDataSetterContext, SettingsSetterContext} from './contexts';
import {game_data_info_list, get_game_data, get_mod_options, vanilla_game_version} from "./GameData.jsx";
import {init_scheme_data} from './scheme_data.jsx';
import {Select} from "antd";

// Import extracted components and utilities
import {IconSlot} from './components/IconSlot.jsx';
import {AddProductModal} from './components/AddProductModal.jsx';
import {ProductEditPopover} from './components/ProductEditPopover.jsx';
import {RecipeSelectorModal} from './components/RecipeSelectorModal.jsx';
import {solveFactoryMatrix} from './utils/matrixSolver.js';

// 增产效果表 - 模块级别常量
const PROLIFERATOR_EFFECTS = {
    0: { name: '无', speedup: 1.0, extra: 1.0, power: 1.0 },
    1: { name: '1级', speedup: 1.25, extra: 1.125, power: 1.3 },
    2: { name: '2级', speedup: 1.5, extra: 1.2, power: 1.7 },
    4: { name: '3级', speedup: 2.0, extra: 1.25, power: 2.5 },
};

export function FactoryPlannerLayout() {
    const global_state = useContext(GlobalStateContext);
    const game_data = global_state?.game_data;
    
    // Mod selection state
    const set_game_data = useContext(GameInfoSetterContext);
    const set_scheme_data = useContext(SchemeDataSetterContext);
    const set_settings = useContext(SettingsSetterContext);
    const [mods, setMods] = useState(() => {
        try {
            const savedMods = localStorage.getItem('dsp_mods');
            if (savedMods) {
                return JSON.parse(savedMods);
            }
        } catch (e) {
            console.error('无法读取缓存的模组选择:', e);
        }
        return [];
    });
    const mod_options = get_mod_options();

    // View State - 从localStorage加载初始数据
    const [plans, setPlans] = useState(() => {
        try {
            const savedPlans = localStorage.getItem('dsp_plans');
            if (savedPlans) {
                const parsed = JSON.parse(savedPlans);
                // 恢复 Set 结构，但保持 recipeId 格式（稍后在 useMemo 中转换）
                return parsed.map(plan => ({
                    ...plan,
                    userFreeItems: new Set(plan.userFreeItems || []),
                    // 保持原始的 productionRows 结构（包含 recipeId）
                    productionRows: plan.productionRows || []
                }));
            }
        } catch (e) {
            console.error('无法读取浏览器缓存的方案:', e);
        }
        // 默认初始值
        return [{
            id: 1,
            name: '新方案',
            products: [],
            productionRows: [],
            userFreeItems: new Set()
        }];
    });

    const [activePlanId, setActivePlanId] = useState(() => {
        try {
            const savedId = localStorage.getItem('dsp_active_plan_id');
            if (savedId) {
                return parseInt(savedId, 10);
            }
        } catch (e) {
            console.error('无法读取缓存的活动方案ID:', e);
        }
        return 1;
    });

    // 初始化时加载保存的模组配置
    useEffect(() => {
        if (mods.length > 0) {
            let new_game_data = get_game_data(mods);
            set_game_data(new_game_data);
            set_scheme_data(init_scheme_data(new_game_data));
        }
    }, []); // 只在组件挂载时执行一次

    // 自动保存到localStorage
    useEffect(() => {
        try {
            const plansToSave = plans.map(plan => ({
                ...plan,
                // Set 无法被 JSON.stringify 序列化，需要转为数组
                userFreeItems: Array.from(plan.userFreeItems),
                // 保存配方名称和增产配置
                productionRows: plan.productionRows
                    .map(row => {
                        const recipeName = row.recipeName || row.recipeObj?.['名称'] || '';
                        return {
                            id: row.id,
                            recipeName: recipeName,
                            isByproductConsumer: row.isByproductConsumer || false,
                            proliferatorMode: row.proliferatorMode || 'none',
                            proliferatorLevel: row.proliferatorLevel || 0,
                            customSpeedup: row.customSpeedup || 1.0,
                            customExtra: row.customExtra || 1.0,
                            selectedFactoryIndex: row.selectedFactoryIndex || 0,
                        };
                    })
                    .filter(row => row.recipeName)
            }));
            localStorage.setItem('dsp_plans', JSON.stringify(plansToSave));
            localStorage.setItem('dsp_active_plan_id', activePlanId.toString());
            localStorage.setItem('dsp_mods', JSON.stringify(mods));
        } catch (e) {
            console.error('无法保存方案到浏览器缓存:', e);
        }
    }, [plans, activePlanId, mods, game_data]);
    
    const activePlan = useMemo(() => plans.find(p => p.id === activePlanId), [plans, activePlanId]);
    const products = useMemo(() => activePlan?.products || [], [activePlan]);
    // 动态将 recipeName 转换为最新的 recipeObj
    const productionRows = useMemo(() => {
        if (!activePlan?.productionRows || !game_data?.recipe_data) return [];
        return activePlan.productionRows.map(row => {
            const recipeName = row.recipeName || row.recipeObj?.['名称'];
            
            if (!recipeName) {
                console.warn('配方没有名称，跳过:', row);
                return null;
            }
            
            const recipeObj = game_data.recipe_data.find(r => r['名称'] === recipeName);
            
            if (!recipeObj) {
                console.warn(`配方 "${recipeName}" 在当前游戏数据中未找到`);
                return null;
            }
            
            return {
                id: row.id,
                recipeName: recipeName,
                recipeObj: recipeObj,
                isByproductConsumer: row.isByproductConsumer || false,
                // 增产配置
                proliferatorMode: row.proliferatorMode || 'none',
                proliferatorLevel: row.proliferatorLevel || 0,
                customSpeedup: row.customSpeedup || 1.0,
                customExtra: row.customExtra || 1.0,
                // 工厂选择
                selectedFactoryIndex: row.selectedFactoryIndex || 0,
            };
        }).filter(row => row !== null);
    }, [activePlan, game_data]);
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
        // 检查所有方案是否有内容
        const hasContent = plans.some(p => p.products.length > 0 || p.productionRows.length > 0);
        if (hasContent) {
            if (!confirm(`检测到规划器内有配方，确认继续切换mod吗？切换后将清空所有生产策略！`)) {
                return;
            }
            // 重置为初始状态：只有一个空方案
            setPlans([{
                id: 1,
                name: '新方案',
                products: [],
                productionRows: [],
                userFreeItems: new Set()
            }]);
            setActivePlanId(1);
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
    const { solvedRows, netIngredients, netByproducts, netStatusMap, solverError, intermediates, problemItems } = useMemo(() => {
        // Setup - preserve row data and calculate factory speed
        const rows = productionRows.map(r => {
            // 获取工厂倍率
            const factoryTypeIndex = r.recipeObj?.["设施"];
            const availableFactories = game_data?.factory_data?.[factoryTypeIndex] || [];
            const selectedFactory = availableFactories[r.selectedFactoryIndex || 0] || availableFactories[0];
            const factorySpeed = selectedFactory?.["倍率"] || 1.0;
            
            return { 
                ...r, 
                factoryCount: 0, 
                inputs: [], 
                outputs: [], 
                mainProducts: [], 
                byproducts: [], 
                catalysts: [],
                factorySpeed: factorySpeed,
                selectedFactory: selectedFactory,
                // Preserve isByproductConsumer from original data, default to false
                isByproductConsumer: r.isByproductConsumer || false
            };
        });
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
            
            // 获取增产配置
            const mode = row.proliferatorMode || 'none';
            const level = row.proliferatorLevel || 0;
            const effect = PROLIFERATOR_EFFECTS[level] || PROLIFERATOR_EFFECTS[0];
            const speedupMultiplier = mode === 'speedup' ? effect.speedup : 1.0;
            const extraMultiplier = mode === 'extra' ? effect.extra : 1.0;
            // 考虑工厂倍率
            const factorySpeed = row.factorySpeed || 1.0;
            const effectiveTime = row.recipeObj.时间 / (speedupMultiplier * factorySpeed);
            
            // Calculate input/output rates with proliferator effects
            Object.entries(outputAmounts).forEach(([item, amount]) => {
                // 产出量受增产模式影响
                const effectiveAmount = amount * extraMultiplier;
                const rate = effectiveAmount * (count / effectiveTime) * 60;
                row.outputs.push({ name: item, count: rate });
                totalNetMap.set(item, (totalNetMap.get(item)||0) + rate);
            });
            
            Object.entries(inputAmounts).forEach(([item, amount]) => {
                // 原料消耗量不受增产影响，但受加速影响（通过effectiveTime）
                const rate = amount * (count / effectiveTime) * 60;
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
        
        // 获取有问题的物品（如果有错误的话）
        const problemItems = result.error?.problemItems || [];
        
        return { 
            solvedRows: rows, 
            netIngredients: netIng, 
            netByproducts: netBy, 
            netStatusMap: totalNetMap,
            solverError: result.error,
            intermediates: result.intermediates || [],
            problemItems: problemItems
        };
    }, [products, productionRows, userFreeItems, game_data?.factory_data]);

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
                recipeName: recipe['名称'],
                isByproductConsumer: isByproductConsumer,
                // 增产配置：模式(none/speedup/extra)，增产剂等级(0/1/2/4)，自定义数值
                proliferatorMode: 'none',
                proliferatorLevel: 0,
                customSpeedup: 1.0,
                customExtra: 1.0,
                // 工厂选择：默认使用第一个可用工厂(index=0)
                selectedFactoryIndex: 0,
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

    // 更新配方的增产配置
    const handleUpdateProliferator = (rowId, field, value) => {
        setProductionRows(prev => prev.map(row => 
            row.id === rowId ? { ...row, [field]: value } : row
        ));
    };

    // 更新配方的工厂选择
    const handleUpdateFactory = (rowId, factoryIndex) => {
        setProductionRows(prev => prev.map(row => 
            row.id === rowId ? { ...row, selectedFactoryIndex: factoryIndex } : row
        ));
    };

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
                        {solvedRows.length === 0 && products.length === 0 ? (
                            <div className="empty-state">请添加目标产物开始规划</div>
                        ) : solvedRows.length === 0 && products.length > 0 ? (
                            <div className="empty-state" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px'}}>
                                <span>👆 点击上方目标产物添加配方,然后依次处理未规划的原料，直至完成设计</span>                                          
                                <span>红色背景表示配方未规划</span>
                                 <span>黄色背景表示物品为副产物</span>
                                  <span>紫色背景表示物品为催化剂</span>
                            </div>
                        ) : (
                            <table className="table-dark">
                                <thead><tr><th style={{width:'30px'}}></th><th>配方</th><th>增产模式</th><th>增产剂</th><th>工厂</th><th>数量</th><th>产物</th><th>副产物</th><th>原料</th></tr></thead>
                                <tbody>
                                    {solvedRows.map(row => {
                                        // 检查配方的增产字段，决定哪些模式可用
                                        const prolifFlag = row.recipeObj['增产'] ?? 0;
                                        const canSpeedup = (prolifFlag & 2) !== 0; // bit 1
                                        const canExtra = (prolifFlag & 1) !== 0;   // bit 0
                                        
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
                                                {/* 增产模式列 */}
                                                <td>
                                                    <div className="btn-group btn-group-sm" style={{flexWrap: 'nowrap'}}>
                                                        <button 
                                                            className={`btn btn-sm ${row.proliferatorMode === 'none' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                                                            style={{padding: '2px 6px', fontSize: '11px', whiteSpace: 'nowrap'}}
                                                            onClick={() => handleUpdateProliferator(row.id, 'proliferatorMode', 'none')}
                                                        >无</button>
                                                        <button 
                                                            className={`btn btn-sm ${row.proliferatorMode === 'speedup' ? 'btn-primary' : 'btn-outline-secondary'}`}
                                                            style={{padding: '2px 6px', fontSize: '11px', whiteSpace: 'nowrap'}}
                                                            disabled={!canSpeedup}
                                                            onClick={() => handleUpdateProliferator(row.id, 'proliferatorMode', 'speedup')}
                                                        >加速</button>
                                                        <button 
                                                            className={`btn btn-sm ${row.proliferatorMode === 'extra' ? 'btn-success' : 'btn-outline-secondary'}`}
                                                            style={{padding: '2px 6px', fontSize: '11px', whiteSpace: 'nowrap'}}
                                                            disabled={!canExtra}
                                                            onClick={() => handleUpdateProliferator(row.id, 'proliferatorMode', 'extra')}
                                                        >增产</button>
                                                    </div>
                                                </td>
                                                {/* 增产剂类型列 */}
                                                <td>
                                                    {row.proliferatorMode !== 'none' ? (
                                                        <div className="d-flex align-items-center gap-1">
                                                            {[0, 1, 2, 4].map(level => {
                                                                const effect = PROLIFERATOR_EFFECTS[level];
                                                                const isSelected = row.proliferatorLevel === level;
                                                                return (
                                                                    <button
                                                                        key={level}
                                                                        className={`btn btn-sm ${isSelected ? 'btn-warning' : 'btn-outline-secondary'}`}
                                                                        style={{padding: '2px 6px', fontSize: '10px', minWidth: '28px'}}
                                                                        onClick={() => handleUpdateProliferator(row.id, 'proliferatorLevel', level)}
                                                                        title={level === 0 ? '无增产剂' : `${effect.name}增产剂: 加速${effect.speedup}x 增产${effect.extra}x`}
                                                                    >
                                                                        {level === 0 ? '无' : level === 4 ? 'III' : level === 2 ? 'II' : 'I'}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <span style={{color: '#666', fontSize: '11px'}}>-</span>
                                                    )}
                                                </td>
                                                {/* 工厂选择列 */}
                                                <td>
                                                    {(() => {
                                                        const factoryTypeIndex = row.recipeObj["设施"];
                                                        const availableFactories = game_data?.factory_data?.[factoryTypeIndex] || [];
                                                        const selectedIndex = row.selectedFactoryIndex || 0;
                                                        const selectedFactory = availableFactories[selectedIndex] || availableFactories[0];
                                                        
                                                        if (availableFactories.length === 0) {
                                                            return <span style={{color: '#666', fontSize: '11px'}}>无可用工厂</span>;
                                                        }
                                                        
                                                        const factoryName = selectedFactory?.["名称"] || "未知";
                                                        
                                                        return (
                                                            <div className="d-flex align-items-center gap-1">
                                                                {availableFactories.length > 1 ? (
                                                                    // 多个工厂可选时显示图标按钮组
                                                                    availableFactories.map((factory, idx) => {
                                                                        const isSelected = idx === selectedIndex;
                                                                        return (
                                                                            <div
                                                                                key={idx}
                                                                                onClick={() => handleUpdateFactory(row.id, idx)}
                                                                                style={{
                                                                                    cursor: 'pointer',
                                                                                    padding: '2px',
                                                                                    borderRadius: '4px',
                                                                                    border: isSelected ? '2px solid #ffc107' : '2px solid transparent',
                                                                                    background: isSelected ? 'rgba(255,193,7,0.15)' : 'transparent',
                                                                                    opacity: isSelected ? 1 : 0.6,
                                                                                }}
                                                                                title={`${factory["名称"]} (倍率: ${factory["倍率"]}x, 能耗: ${factory["耗能"].toFixed(1)}MW)`}
                                                                            >
                                                                                <IconSlot item={factory["名称"]} type="factory" />
                                                                            </div>
                                                                        );
                                                                    })
                                                                ) : (
                                                                    // 只有一个工厂时直接显示
                                                                    <IconSlot item={factoryName} type="factory" />
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                                {/* 工厂数量列 */}
                                                <td>
                                                    <span>x{row.factoryCount}</span>
                                                </td>
                              
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
                        )}
                    </div>
                    </div>

                    {/* Bottom Status Bar - inside the right column */}
                    <div className="fp-statusbar" style={{
                        height: '44px',
                        minHeight: '44px',
                        maxHeight: '44px',
                        background: 'linear-gradient(180deg, #2a2a2a 0%, #222 100%)',
                        borderTop: '1px solid #444',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '4px 12px',
                        gap: '16px',
                        overflow: 'hidden'
                    }}>
                {/* Error Status */}
                {solverError && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ff6b6b', flexShrink: 0 }}>
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
                
                {/* Intermediate Items - 优先显示有问题的物品 */}
                {intermediates.length > 0 && (
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px', 
                        marginLeft: solverError ? '16px' : '0',
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden'
                    }}>
                        <span style={{ color: '#4a90d9', fontSize: '12px', fontWeight: 'bold', flexShrink: 0 }}>中间产物:</span>
                        <span 
                            style={{ 
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '14px',
                                height: '14px',
                                borderRadius: '50%',
                                border: '1px solid #666',
                                color: '#888',
                                fontSize: '10px',
                                cursor: 'help',
                                flexShrink: 0
                            }}
                            title="自由变量说明：&#10;&#10;当配方之间存在循环依赖（如A需要B，B也需要A），&#10;或者某个中间产物有多个来源时，矩阵可能存在&#10;「冗余约束」导致无法求解。&#10;&#10;将中间产物设为「自由变量」意味着允许它从外部&#10;输入或输出，从而打破循环依赖，使系统可解。&#10;&#10;设为自由变量后，该物品会出现在「原料输入」或&#10;「副产物」栏中，表示需要外部提供或有多余产出。"
                        >?</span>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '2px',
                            overflowX: 'auto',
                            overflowY: 'hidden',
                            flex: 1,
                            minWidth: 0,
                            scrollbarWidth: 'thin',
                            scrollbarColor: '#555 #333'
                        }}>
                            {/* 先显示有问题的物品（红色边框） */}
                            {problemItems.filter(item => intermediates.includes(item)).map((item, i) => {
                                const isFree = userFreeItems.has(item);
                                return (
                                    <div 
                                        key={`problem-${i}`} 
                                        onClick={() => toggleFreeItem(item)}
                                        style={{
                                            cursor: 'pointer',
                                            border: isFree ? '2px solid #88cc88' : '2px solid #ff6b6b',
                                            borderRadius: '4px',
                                            background: isFree ? 'rgba(136, 204, 136, 0.2)' : 'rgba(255, 107, 107, 0.15)',
                                            transform: 'scale(0.75)',
                                            marginLeft: '-4px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            flexShrink: 0
                                        }}
                                        title={isFree ? '点击取消自由变量' : '⚠️ 建议设为自由变量以解决冲突'}
                                    >
                                        <IconSlot item={item} type={isFree ? "product-satisfied" : "ingredient"} />
                                        {isFree && <div style={{ fontSize: '9px', color: '#88cc88', marginTop: '-4px' }}>自由</div>}
                                        {!isFree && <div style={{ fontSize: '9px', color: '#ff6b6b', marginTop: '-4px' }}>冲突</div>}
                                    </div>
                                );
                            })}
                            {/* 分隔线（如果有问题物品和其他物品） */}
                            {problemItems.filter(item => intermediates.includes(item)).length > 0 && 
                             intermediates.filter(item => !problemItems.includes(item)).length > 0 && (
                                <div style={{ 
                                    width: '1px', 
                                    height: '28px', 
                                    background: '#555', 
                                    margin: '0 4px',
                                    flexShrink: 0 
                                }} />
                            )}
                            {/* 其他中间产物 */}
                            {intermediates.filter(item => !problemItems.includes(item)).map((item, i) => {
                                const isFree = userFreeItems.has(item);
                                return (
                                    <div 
                                        key={`other-${i}`} 
                                        onClick={() => toggleFreeItem(item)}
                                        style={{
                                            cursor: 'pointer',
                                            border: isFree ? '2px solid #88cc88' : '2px solid transparent',
                                            borderRadius: '4px',
                                            background: isFree ? 'rgba(136, 204, 136, 0.2)' : 'transparent',
                                            transform: 'scale(0.75)',
                                            marginLeft: '-4px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            flexShrink: 0,
                                            opacity: 0.6
                                        }}
                                        title={isFree ? '点击取消自由变量' : '点击设为自由变量'}
                                    >
                                        <IconSlot item={item} type={isFree ? "product-satisfied" : "intermediate"} />
                                        {isFree && <div style={{ fontSize: '9px', color: '#88cc88', marginTop: '-4px' }}>自由</div>}
                                    </div>
                                );
                            })}
                        </div>
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