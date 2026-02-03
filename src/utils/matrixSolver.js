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

export function solveFactoryMatrix(rows, products, userFreeItems = new Set()) {
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
    
    // Check for dependent columns
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
