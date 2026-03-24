const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');

let shapes = [];
let historyStack = [];
let historyIndex = -1;

let currentTool = "SELECT"; // SELECT, SHAPE, POLY, CURVE, PAN, TRANSFORM
let floorVisible = false;
let shrinkwrapOffset = 10;
let shrinkwrapShape = null;

let bgImage = null;
let bgOpacity = 0.5;
let bgColor = 255;
let currentClassColor = "#FF0000";
let selectedShapes = [];
let isMarquee = false;
let marqueeStart = {x:0, y:0};
let marqueeCurrent = {x:0, y:0};

let resizing = false;
let resizeCorner = "";
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragStartPoint = {x:0, y:0};
let shrinkwrapActive = false;
let selectedNodeIndex = -1;

let currentUnit = "px";
let pixelsPerUnit = 1;
let calibrateStart = null;

let blockLibrary = {};
let isEditingBlock = false;
let editingBlockId = null;
let preEditShapes = [];
let preEditBg = 255;

function hitTest(s, mx, my) {
    if (s.isShrinkwrap) return ptInConvexPolygon(mx, my, s.vertices);
    if (s.type === 'group') {
        for(let i=0; i<s.children.length; i++) if(hitTest(s.children[i], mx, my)) return true;
        return false;
    }
    if (s.type === 'blockRef') {
        let master = blockLibrary[s.blockId];
        if (!master) return false;
        let localMx = mx - s.x; let localMy = my - s.y;
        for(let i=0; i<master.children.length; i++) if(hitTest(master.children[i], localMx, localMy)) return true;
        return false;
    }
    if (s.type === 'shape' || s.type === 'rect') return (mx >= s.x - s.w/2 && mx <= s.x + s.w/2 && my >= s.y - s.h/2 && my <= s.y + s.h/2);
    else if (s.type === 'poly' || s.type === 'curve') {
        let collision = false;
        let regions = []; let currentReg = [];
        s.vertices.forEach(v => {
            if (v.moveTo && currentReg.length > 0) { regions.push(currentReg); currentReg = []; }
            currentReg.push(v);
        });
        if (currentReg.length > 0) regions.push(currentReg);
        regions.forEach(reg => {
            for (let i = 0, j = reg.length - 1; i < reg.length; j = i++) {
                let xi = reg[i].x, yi = reg[i].y; let xj = reg[j].x, yj = reg[j].y;
                let intersect = ((yi > my) !== (yj > my)) && (mx < (xj - xi) * (my - yi) / (yj - yi) + xi);
                if (intersect) collision = !collision;
            }
        });
        return collision;
    }
    return false;
}

function ptInConvexPolygon(px, py, vertices) {
    let collision = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        let xi = vertices[i].x, yi = vertices[i].y;
        let xj = vertices[j].x, yj = vertices[j].y;
        let intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersect) collision = !collision;
    }
    return collision;
}

function getShapeBounds(s) {
    if (s.type === 'group') {
        let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
        s.children.forEach(c => {
            let b = getShapeBounds(c);
            if (b.minX < minX) minX = b.minX; if (b.maxX > maxX) maxX = b.maxX;
            if (b.minY < minY) minY = b.minY; if (b.maxY > maxY) maxY = b.maxY;
        });
        return {minX, maxX, minY, maxY};
    }
    if (s.type === 'blockRef') {
        let master = blockLibrary[s.blockId];
        if (!master || master.children.length===0) return {minX: s.x, maxX: s.x, minY: s.y, maxY: s.y};
        let b = getShapeBounds({type: 'group', children: master.children});
        return {minX: b.minX + s.x, maxX: b.maxX + s.x, minY: b.minY + s.y, maxY: b.maxY + s.y};
    }
    if (s.type === 'shape' || s.type === 'rect') return {minX: s.x - s.w/2, maxX: s.x + s.w/2, minY: s.y - s.h/2, maxY: s.y + s.h/2};
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    s.vertices.forEach(v => {
        if(v.x<minX)minX=v.x; if(v.x>maxX)maxX=v.x; if(v.y<minY)minY=v.y; if(v.y>maxY)maxY=v.y;
    });
    return {minX, maxX, minY, maxY};
}

function translateShape(s, dx, dy) {
    if (s.isShrinkwrap) return;
    if (s.type === 'group') s.children.forEach(c => translateShape(c, dx, dy));
    else if (s.type === 'blockRef') { s.x += dx; s.y += dy; }
    else if (s.type === 'shape' || s.type === 'rect') { s.x += dx; s.y += dy; }
    else if (s.type === 'poly' || s.type === 'curve') s.vertices.forEach(v => { v.x += dx; v.y += dy; });
}

function deepConvertToPoly(s) {
    if (s.type === 'group') {
        s.children.forEach((c, idx) => { s.children[idx] = deepConvertToPoly(c); });
    } else if (s.type === 'blockRef') {
        let master = blockLibrary[s.blockId];
        if (!master) return s;
        let exploded = {type: 'group', children: JSON.parse(JSON.stringify(master.children)) };
        exploded.children.forEach(c => translateShape(c, s.x, s.y));
        return deepConvertToPoly(exploded);
    } else if (s.type === 'shape' || s.type === 'rect') {
        s = convertShapeToPoly(s); 
    }
    return s;
}

// Pan state
let panOffsetX = 0;
let panOffsetY = 0;
let isPanning = false;

// Drawing state
let isDrawingShape = false;
let drawStartX = 0;
let drawStartY = 0;
let currentPolyVertices = [];

// Shape Tool Config
let currentShapeType = 'rect';
let currentShapeIconClass = 'ph-square';

// Transform State Variables
let currentTransformType = 'copy';
let transformActive = false;
let transformOriginalPoly = null;
let transformPivot = null;
let transformStartAngle = 0;
let transformStartMouse = null;

function convertShapeToPoly(s) {
    if (s.type === 'poly' || s.type === 'curve') return JSON.parse(JSON.stringify(s));
    let v = [];
    if (s.type === 'shape' || s.type === 'rect') {
        const dx = s.x - s.w/2, dy = s.y - s.h/2;
        if (s.subType === 'triangle') v = [{x:s.x, y:dy}, {x:dx+s.w, y:dy+s.h}, {x:dx, y:dy+s.h}];
        else if (s.subType === 'diamond') v = [{x:s.x, y:dy}, {x:dx+s.w, y:s.y}, {x:s.x, y:dy+s.h}, {x:dx, y:s.y}];
        else if (s.subType === 'trapezoid') { let inset=s.w*0.25; v=[{x:dx+inset,y:dy},{x:dx+s.w-inset,y:dy},{x:dx+s.w,y:dy+s.h},{x:dx,y:dy+s.h}]; }
        else if (s.subType === 'ellipse') { for(let i=0;i<24;i++) { let a=(i/24)*Math.PI*2; v.push({x:s.x+(s.w/2)*Math.cos(a),y:s.y+(s.h/2)*Math.sin(a)}); } }
        else v = [{x:dx,y:dy}, {x:dx+s.w,y:dy}, {x:dx+s.w,y:dy+s.h}, {x:dx,y:dy+s.h}]; // rect, round_rect, human bbox
    }
    return { type: 'poly', vertices: v, fillColor: s.fillColor };
}

function chaikinClosed(vertices, iterations) {
    if (vertices.length < 3) return vertices;
    let pts = vertices;
    for (let i = 0; i < iterations; i++) {
        let newPts = [];
        for (let j = 0; j < pts.length; j++) {
            let p1 = pts[j];
            let p2 = pts[(j + 1) % pts.length];
            newPts.push({ x: 0.75 * p1.x + 0.25 * p2.x, y: 0.75 * p1.y + 0.25 * p2.y });
            newPts.push({ x: 0.25 * p1.x + 0.75 * p2.x, y: 0.25 * p1.y + 0.75 * p2.y });
        }
        pts = newPts;
    }
    return pts;
}

function chaikinOpen(vertices, iterations) {
    if (vertices.length < 3) return vertices;
    let pts = vertices;
    for (let i = 0; i < iterations; i++) {
        let newPts = [];
        newPts.push(pts[0]);
        for (let j = 0; j < pts.length - 1; j++) {
            let p1 = pts[j];
            let p2 = pts[j + 1];
            newPts.push({ x: 0.75 * p1.x + 0.25 * p2.x, y: 0.75 * p1.y + 0.25 * p2.y });
            newPts.push({ x: 0.25 * p1.x + 0.75 * p2.x, y: 0.25 * p1.y + 0.75 * p2.y });
        }
        newPts.push(pts[pts.length - 1]);
        pts = newPts;
    }
    return pts;
}

function saveState() {
    historyStack = historyStack.slice(0, historyIndex + 1);
    const clone = JSON.parse(JSON.stringify({shapes: shapes, shrinkwrapShape: shrinkwrapShape, blockLibrary: blockLibrary}));
    historyStack.push(clone);
    historyIndex++;
}
saveState();

// Undo/Redo & Shortcuts
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        isMarquee = false; isDrawingShape = false; transformActive = false;
        resizing = false; isDragging = false; calibrateStart = null;
        currentPolyVertices = []; selectedNodeIndex = -1;
        draw(); return;
    }
    if (selectedShapes.length > 0 && e.key === '[') {
        selectedShapes.forEach(s => {
            const idx = shapes.indexOf(s);
            if (idx > 0) { shapes.splice(idx, 1); shapes.splice(idx - 1, 0, s); }
        });
        saveState(); draw();
    }
    if (selectedShapes.length > 0 && e.key === ']') {
        for(let i=selectedShapes.length-1; i>=0; i--) {
            const idx = shapes.indexOf(selectedShapes[i]);
            if (idx > -1 && idx < shapes.length - 1) { shapes.splice(idx, 1); shapes.splice(idx + 1, 0, selectedShapes[i]); }
        }
        saveState(); draw();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapes.length > 0) {
        if (selectedNodeIndex > -1 && selectedShapes.length === 1 && (selectedShapes[0].type === 'poly' || selectedShapes[0].type === 'curve')) {
            let s = selectedShapes[0];
            let ptsCount = 0; s.vertices.forEach(v => { if(!v.moveTo) ptsCount++; });
            if (ptsCount > 3) {
                s.vertices.splice(selectedNodeIndex, 1); selectedNodeIndex = -1;
                saveState(); draw(); return;
            } else { alert("Cannot reduce polygon below 3 vertices."); return; }
        }
        
        if (selectedShapes.length === 1 && selectedShapes[0].isShrinkwrap) {
            shrinkwrapShape = null; shrinkwrapActive = false;
            document.getElementById('btnShrinkwrap').title = "Compute Shrinkwrap";
            document.getElementById('btnShrinkwrap').classList.remove('active');
        } else {
            selectedShapes.forEach(s => {
                const idx = shapes.indexOf(s);
                if (idx > -1) shapes.splice(idx, 1);
            });
            if (shrinkwrapActive) updateShrinkwrap();
        }
        selectedShapes = []; updatePropertiesPanel(); saveState(); draw();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        if (historyIndex > 0) {
            historyIndex--;
            const state = historyStack[historyIndex];
            shapes = JSON.parse(JSON.stringify(state.shapes));
            shrinkwrapShape = state.shrinkwrapShape ? JSON.parse(JSON.stringify(state.shrinkwrapShape)) : null;
            if (state.blockLibrary) blockLibrary = JSON.parse(JSON.stringify(state.blockLibrary));
            selectedShapes = []; updatePropertiesPanel(); draw();
        }
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        document.getElementById('btnUngroup').click();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        document.getElementById('btnGroup').click();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        if (historyIndex < historyStack.length - 1) {
            historyIndex++;
            const state = historyStack[historyIndex];
            shapes = JSON.parse(JSON.stringify(state.shapes));
            shrinkwrapShape = state.shrinkwrapShape ? JSON.parse(JSON.stringify(state.shrinkwrapShape)) : null;
            if (state.blockLibrary) blockLibrary = JSON.parse(JSON.stringify(state.blockLibrary));
            selectedShapes = []; updatePropertiesPanel(); draw();
        }
    }
    
    // Tools
    if (e.key.toLowerCase() === 'v' && document.activeElement.tagName !== 'INPUT') setTool('SELECT');
    if (e.key.toLowerCase() === 'm' && document.activeElement.tagName !== 'INPUT') setTool('SHAPE');
    if (e.key.toLowerCase() === 'p' && document.activeElement.tagName !== 'INPUT') setTool('POLY');
    if (e.key.toLowerCase() === 'c' && document.activeElement.tagName !== 'INPUT') setTool('CURVE');
    if (e.key.toLowerCase() === 'h' && document.activeElement.tagName !== 'INPUT') setTool('PAN');
    if (e.key.toLowerCase() === 't' && document.activeElement.tagName !== 'INPUT') setTool('TRANSFORM');
});

// Setup Toolbar
document.getElementById('toolSelect').addEventListener('click', () => setTool('SELECT'));
document.getElementById('toolShape').addEventListener('click', () => setTool('SHAPE'));
document.getElementById('toolPoly').addEventListener('click', () => setTool('POLY'));
document.getElementById('toolCurve').addEventListener('click', () => setTool('CURVE'));
document.getElementById('toolTransform').addEventListener('click', () => setTool('TRANSFORM'));
document.getElementById('toolPan').addEventListener('click', () => setTool('PAN'));
document.getElementById('toolCalibrate').addEventListener('click', () => setTool('CALIBRATE'));

document.querySelectorAll('.flyout-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.flyout-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentShapeType = btn.dataset.shape;
        document.getElementById('currentShapeIcon').className = `ph ${btn.dataset.icon}`;
        setTool('SHAPE');
    });
});

document.querySelectorAll('.flyout-btn-tx').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.flyout-btn-tx').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTransformType = btn.dataset.tx;
        document.getElementById('currentTransformIcon').className = `ph ${btn.dataset.icon}`;
        setTool('TRANSFORM');
        
        let pnl = document.getElementById('array-panel');
        if (currentTransformType.startsWith('array_')) {
            pnl.style.display = 'block';
            document.getElementById('arrayRectOptions').style.display = currentTransformType==='array_rect'?'block':'none';
            document.getElementById('arrayPolarOptions').style.display = currentTransformType==='array_polar'?'block':'none';
            document.getElementById('arrayPanelTitle').textContent = currentTransformType==='array_rect'?'Rect Array Properties':'Polar Array Properties';
        } else pnl.style.display = 'none';
    });
});

document.getElementById('btnGroup').addEventListener('click', () => {
    if (selectedShapes.length > 1) {
        let g = { type: 'group', id: 'grp_'+Date.now(), children: [] };
        selectedShapes.forEach(s => {
            let idx = shapes.indexOf(s);
            if (idx > -1) { shapes.splice(idx, 1); g.children.push(s); }
        });
        shapes.push(g); selectedShapes = [g];
        updatePropertiesPanel(); saveState(); draw();
    }
});
document.getElementById('btnUngroup').addEventListener('click', () => {
    let newShapes = [];
    selectedShapes.forEach(s => {
        if (s.type === 'group') {
            const idx = shapes.indexOf(s);
            if (idx > -1) shapes.splice(idx, 1);
            s.children.forEach(c => { shapes.push(c); newShapes.push(c); });
        } else {
            newShapes.push(s);
        }
    });
    selectedShapes = newShapes; updatePropertiesPanel(); saveState(); draw();
});

document.getElementById('btnMakeBlock').addEventListener('click', () => {
    if (selectedShapes.length > 0) {
        let id = 'blk_' + Date.now();
        let b = getShapeBounds({type: 'group', children: selectedShapes});
        let cx = (b.minX + b.maxX)/2; let cy = (b.minY + b.maxY)/2;
        let masterChildren = JSON.parse(JSON.stringify(selectedShapes));
        masterChildren.forEach(c => translateShape(c, -cx, -cy));
        blockLibrary[id] = { id: id, children: masterChildren };
        let instance = { type: 'blockRef', blockId: id, x: cx, y: cy };
        selectedShapes.forEach(s => { let idx = shapes.indexOf(s); if (idx > -1) shapes.splice(idx, 1); });
        shapes.push(instance); selectedShapes = [instance];
        updatePropertiesPanel(); saveState(); draw();
    }
});
document.getElementById('btnEditBlock').addEventListener('click', () => {
    if (selectedShapes.length === 1 && selectedShapes[0].type === 'blockRef') {
        let id = selectedShapes[0].blockId;
        isEditingBlock = true; editingBlockId = id;
        preEditShapes = shapes; preEditBg = bgColor;
        shapes = JSON.parse(JSON.stringify(blockLibrary[id].children));
        bgColor = 230; selectedShapes = [];
        document.getElementById('btnMakeBlock').style.display = 'none';
        document.getElementById('btnEditBlock').style.display = 'none';
        document.getElementById('btnExitBlockEdit').style.display = 'inline-block';
        updatePropertiesPanel(); draw();
    }
});
document.getElementById('btnExitBlockEdit').addEventListener('click', () => {
    if (isEditingBlock) {
        blockLibrary[editingBlockId].children = JSON.parse(JSON.stringify(shapes));
        shapes = preEditShapes; bgColor = preEditBg;
        isEditingBlock = false; editingBlockId = null; selectedShapes = [];
        document.getElementById('btnExitBlockEdit').style.display = 'none';
        document.getElementById('btnMakeBlock').style.display = 'inline-block';
        updatePropertiesPanel(); saveState(); draw();
    }
});

// PolyBool JS Boolean Engine
function polyToPolyBool(shape) {
    if (shape.type === 'shape' || shape.type === 'rect') shape = convertShapeToPoly(shape);
    if (shape.type === 'blockRef') shape = deepConvertToPoly(shape);
    let regions = []; let currentReg = [];
    shape.vertices.forEach(v => {
        if (v.moveTo && currentReg.length > 0) { regions.push(currentReg); currentReg = []; }
        currentReg.push([v.x, v.y]);
    });
    if (currentReg.length > 0) regions.push(currentReg);
    return { regions: regions, inverted: false };
}

function applyBoolean(operation) {
    if (selectedShapes.length < 2) return;
    let flats = [];
    selectedShapes.forEach(s => {
        let p = deepConvertToPoly(JSON.parse(JSON.stringify(s)));
        if (p.type === 'group') {
            const extract = (g) => { g.children.forEach(c => { if(c.type==='group') extract(c); else if(c.vertices) flats.push(c); }); };
            extract(p);
        } else if (p.vertices) flats.push(p);
    });
    if (flats.length < 2) return;
    
    let pbResult = polyToPolyBool(flats[0]);
    let targetColor = flats[0].fillColor;
    for(let i=1; i<flats.length; i++) {
        let pbNext = polyToPolyBool(flats[i]);
        if (operation === 'unite') pbResult = PolyBool.union(pbResult, pbNext);
        else if (operation === 'subtract') pbResult = PolyBool.difference(pbResult, pbNext);
        else if (operation === 'intersect') pbResult = PolyBool.intersect(pbResult, pbNext);
    }
    
    let verts = [];
    pbResult.regions.forEach((region, i) => {
        region.forEach((pt, j) => {
            verts.push({ x: pt[0], y: pt[1], moveTo: j === 0 });
        });
    });
    
    if (verts.length === 0) return; // Full destruction
    let newShape = { type: 'poly', vertices: verts, fillColor: targetColor };
    
    selectedShapes.forEach(s => {
        let idx = shapes.indexOf(s);
        if (idx > -1) shapes.splice(idx, 1);
    });
    shapes.push(newShape);
    selectedShapes = [newShape];
    updatePropertiesPanel(); saveState(); draw();
}

document.getElementById('btnBoolUnite').addEventListener('click', () => applyBoolean('unite'));
document.getElementById('btnBoolSubtract').addEventListener('click', () => applyBoolean('subtract'));
document.getElementById('btnBoolIntersect').addEventListener('click', () => applyBoolean('intersect'));

document.getElementById('btnWallOffset').addEventListener('click', () => {
    if (selectedShapes.length === 0) return;
    let dist = Math.abs(parseFloat(document.getElementById('propWallThickness').value) || 10);
    
    let newShapes = [];
    selectedShapes.forEach(s => {
        let p = deepConvertToPoly(JSON.parse(JSON.stringify(s)));
        if (!p.vertices || p.vertices.length < 3) { newShapes.push(s); return; }
        
        let shapeRegions = []; let currentReg = [];
        p.vertices.forEach(v => {
            if (v.moveTo && currentReg.length > 0) { shapeRegions.push(currentReg); currentReg = []; }
            currentReg.push(v);
        });
        if (currentReg.length > 0) shapeRegions.push(currentReg);

        shapeRegions.forEach(reg => {
            if (reg.length < 3) return;
            let flats = []; const segments = 12;
            reg.forEach(v => {
                let circle = [];
                for(let i=0; i<segments; i++) circle.push([v.x + dist*Math.cos(i/segments*Math.PI*2), v.y + dist*Math.sin(i/segments*Math.PI*2)]);
                flats.push({regions: [circle], inverted: false});
            });
            for(let i=0; i<reg.length; i++) {
                let v1 = reg[i]; let v2 = reg[(i+1)%reg.length];
                let a = Math.atan2(v2.y-v1.y, v2.x-v1.x); let nx = Math.sin(a)*dist; let ny = -Math.cos(a)*dist;
                flats.push({regions: [[[v1.x+nx, v1.y+ny], [v2.x+nx, v2.y+ny], [v2.x-nx, v2.y-ny], [v1.x-nx, v1.y-ny]]], inverted: false});
            }
            
            let pbResult = flats[0];
            for(let i=1; i<flats.length; i++) pbResult = PolyBool.union(pbResult, flats[i]);
            
            let origReg = reg.map(pt => [pt.x, pt.y]);
            pbResult = PolyBool.difference(pbResult, {regions: [origReg], inverted: false});
            
            let verts = [];
            pbResult.regions.forEach((region, i) => {
                region.forEach((pt, j) => verts.push({ x: pt[0], y: pt[1], moveTo: j === 0 }));
            });
            if(verts.length > 0) newShapes.push({ type: 'poly', vertices: verts, fillColor: currentClassColor });
        });
        
        let idx = shapes.indexOf(s);
        if(idx>-1) shapes.splice(idx, 1);
    });
    
    newShapes.forEach(ns => shapes.push(ns));
    selectedShapes = newShapes;
    updatePropertiesPanel(); saveState(); draw();
});

document.getElementById('btnApplyRectArray').addEventListener('click', () => {
    if (selectedShapes.length !== 1) return alert("Select exactly one shape to array.");
    let selectedShape = selectedShapes[0];
    const rows = parseInt(document.getElementById('arrRows').value);
    const cols = parseInt(document.getElementById('arrCols').value);
    const gapX = parseFloat(document.getElementById('arrGapX').value);
    const gapY = parseFloat(document.getElementById('arrGapY').value);
    const basePoly = convertShapeToPoly(selectedShape);
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    basePoly.vertices.forEach(v=>{if(v.x<minX)minX=v.x; if(v.x>maxX)maxX=v.x; if(v.y<minY)minY=v.y; if(v.y>maxY)maxY=v.y;});
    
    let stepX = (maxX - minX) + gapX;
    let stepY = (maxY - minY) + gapY;
    const idx = shapes.indexOf(selectedShape);
    if(idx>-1) shapes.splice(idx, 1);
    for(let r=0; r<rows; r++) {
        for(let c=0; c<cols; c++) {
            let clone = JSON.parse(JSON.stringify(basePoly));
            clone.vertices.forEach(v => { v.x += c * stepX; v.y += r * stepY; });
            shapes.push(clone);
        }
    }
    selectedShapes = []; setTool('SELECT'); saveState(); draw();
});

document.getElementById('btnApplyPolarArray').addEventListener('click', () => {
    if (selectedShapes.length !== 1) return alert("Select exactly one shape to array.");
    let selectedShape = selectedShapes[0];
    const count = parseInt(document.getElementById('arrCount').value);
    const totalAngle = parseFloat(document.getElementById('arrAngle').value) * Math.PI / 180;
    const basePoly = convertShapeToPoly(selectedShape);
    
    let cx=0, cy=0;
    basePoly.vertices.forEach(v=>{cx+=v.x; cy+=v.y;});
    cx /= basePoly.vertices.length; cy /= basePoly.vertices.length;
    
    const idx = shapes.indexOf(selectedShape);
    if(idx>-1) shapes.splice(idx, 1);
    for(let i=0; i<count; i++) {
        let angle = i * (totalAngle / count);
        let clone = JSON.parse(JSON.stringify(basePoly));
        clone.vertices.forEach(v => {
            let dx = v.x - cx; let dy = v.y - cy;
            v.x = cx + dx*Math.cos(angle) - dy*Math.sin(angle);
            v.y = cy + dx*Math.sin(angle) + dy*Math.cos(angle);
        });
        shapes.push(clone);
    }
    selectedShapes = []; setTool('SELECT'); saveState(); draw();
});

function setTool(tool) {
    if ((currentTool === 'POLY' || currentTool === 'CURVE') && currentPolyVertices.length > 2 && tool !== currentTool) {
        shapes.push({ type: currentTool === 'POLY' ? 'poly' : 'curve', vertices: currentPolyVertices, fillColor: currentClassColor });
        saveState();
        if (shrinkwrapActive) updateShrinkwrap();
    }
    currentPolyVertices = [];
    isDrawingShape = false;

    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    
    if (tool === 'SELECT') document.getElementById('toolSelect').classList.add('active');
    if (tool === 'SHAPE') document.getElementById('toolShape').classList.add('active');
    if (tool === 'POLY') document.getElementById('toolPoly').classList.add('active');
    if (tool === 'CURVE') document.getElementById('toolCurve').classList.add('active');
    if (tool === 'TRANSFORM') document.getElementById('toolTransform').classList.add('active');
    if (tool === 'PAN') document.getElementById('toolPan').classList.add('active');
    if (tool === 'CALIBRATE') document.getElementById('toolCalibrate').classList.add('active');
    
    if (tool !== 'TRANSFORM') document.getElementById('array-panel').style.display = 'none';
    
    canvas.style.cursor = tool === 'PAN' ? 'grab' : ((tool === 'POLY' || tool === 'CURVE' || tool === 'SHAPE' || tool === 'CALIBRATE') ? 'crosshair' : 'default');
    
    if (tool !== 'SELECT' && tool !== 'TRANSFORM') {
        selectedShapes = [];
        updatePropertiesPanel();
    }
    draw();
}

// Update Properties Panel sync
const propX = document.getElementById('propX');
const propY = document.getElementById('propY');
const propW = document.getElementById('propW');
const propH = document.getElementById('propH');
const propsContainer = document.getElementById('propertiesPanel');

[propX, propY, propW, propH].forEach(input => {
    input.addEventListener('change', (e) => {
        if (selectedShapes.length === 1) {
            let s = selectedShapes[0];
            if (s.type === 'shape' || s.type === 'rect') {
                s.x = parseFloat(propX.value);
                s.y = parseFloat(propY.value);
                s.w = parseFloat(propW.value);
                s.h = parseFloat(propH.value);
                if (shrinkwrapActive) updateShrinkwrap();
                saveState(); draw();
            }
        }
    });
});

function getPolygonArea(vertices) {
    if (!vertices || vertices.length < 3) return 0;
    let regions = []; let currentReg = [];
    vertices.forEach(v => {
        if (v.moveTo && currentReg.length > 0) { regions.push(currentReg); currentReg = []; }
        currentReg.push(v);
    });
    if (currentReg.length > 0) regions.push(currentReg);
    
    let totalArea = 0;
    regions.forEach(reg => {
        if (reg.length < 3) return;
        let area = 0;
        for (let i = 0; i < reg.length; i++) {
            let j = (i + 1) % reg.length;
            area += reg[i].x * reg[j].y;
            area -= reg[j].x * reg[i].y;
        }
        totalArea += (area / 2);
    });
    return Math.abs(totalArea);
}

function updatePropertiesPanel() {
    const propsContainer = document.getElementById('propertiesPanel');
    const multiContainer = document.getElementById('multiPropertiesPanel');
    
    let computeArea = () => {
        if (selectedShapes.length === 0) return 0;
        let areaPx = 0;
        selectedShapes.forEach(s => {
            let p = deepConvertToPoly(JSON.parse(JSON.stringify(s)));
            if (p.type === 'group') {
                const extractArea = (g) => {
                    g.children.forEach(c => {
                        if (c.type === 'group') extractArea(c);
                        else if (c.vertices) areaPx += getPolygonArea(c.vertices);
                    });
                };
                extractArea(p);
            } else if (p.vertices) {
                areaPx += getPolygonArea(p.vertices);
            }
        });
        return areaPx;
    };
    
    let areaPx = computeArea();
    let realArea = areaPx / (pixelsPerUnit * pixelsPerUnit);
    document.querySelectorAll('.propAreaVal').forEach(el => el.textContent = realArea < 10 ? realArea.toFixed(2) : Math.round(realArea));
    document.querySelectorAll('.propAreaUnit').forEach(el => el.textContent = currentUnit + "²");

    if (selectedShapes.length === 1) {
        multiContainer.style.display = 'none';
        let s = selectedShapes[0];
        document.getElementById('btnEditBlock').style.display = s.type === 'blockRef' ? 'inline-block' : 'none';
        document.getElementById('btnMakeBlock').style.display = s.type === 'blockRef' ? 'none' : 'inline-block';
        
        if (s.type === 'shape' || s.type === 'rect') {
            propsContainer.style.display = 'block';
            propX.value = Math.round(s.x);
            propY.value = Math.round(s.y);
            propW.value = Math.round(s.w);
            propH.value = Math.round(s.h);
        } else {
            propsContainer.style.display = 'none';
        }
    } else if (selectedShapes.length > 1) {
        propsContainer.style.display = 'none';
        multiContainer.style.display = 'block';
        document.getElementById('btnEditBlock').style.display = 'none';
        document.getElementById('btnMakeBlock').style.display = 'inline-block';
        document.getElementById('multiSelectionText').textContent = `${selectedShapes.length} Items Selected`;
    } else {
        propsContainer.style.display = 'none';
        multiContainer.style.display = 'none';
        document.getElementById('btnEditBlock').style.display = 'none';
        document.getElementById('btnMakeBlock').style.display = 'inline-block';
    }
}

// Setup Standard UI Listeners
document.getElementById('semanticColor').addEventListener('change', (e) => {
    currentClassColor = e.target.value;
    if (selectedShapes.length > 0) {
        selectedShapes.forEach(s => s.fillColor = currentClassColor);
        saveState(); draw();
    }
});
document.getElementById('bgColor').addEventListener('input', (e) => { bgColor = parseInt(e.target.value); draw(); });
document.getElementById('shrinkOffset').addEventListener('input', (e) => {
    document.getElementById('shrinkOffsetVal').textContent = e.target.value;
    shrinkwrapOffset = parseInt(e.target.value);
    if (shrinkwrapActive) updateShrinkwrap();
});
const btnFloor = document.getElementById('btnFloor');
btnFloor.addEventListener('click', () => {
    floorVisible = !floorVisible;
    if(floorVisible) btnFloor.classList.add('active'); else btnFloor.classList.remove('active');
    btnFloor.title = floorVisible ? "Remove Floor Plane" : "Add Floor Plane";
    draw();
});
const btnShrinkwrap = document.getElementById('btnShrinkwrap');
btnShrinkwrap.addEventListener('click', () => {
    shrinkwrapActive = !shrinkwrapActive;
    if (shrinkwrapActive) {
        if (shapes.length < 3) { shrinkwrapActive = false; return; }
        shrinkwrapShape = { isShrinkwrap: true, fillColor: currentClassColor, vertices: [] };
        updateShrinkwrap();
        btnShrinkwrap.title = "Remove Shrinkwrap"; btnShrinkwrap.classList.add('active');
        saveState();
    } else {
        shrinkwrapShape = null;
        btnShrinkwrap.title = "Compute Shrinkwrap"; btnShrinkwrap.classList.remove('active');
        saveState(); draw();
    }
});
document.getElementById('btnExportPNG').addEventListener('click', () => {
    const wasSelected = [...selectedShapes];
    selectedShapes = [];
    let oldTool = currentTool;
    currentTool = "EXPORTING"; 
    draw(); 
    const link = document.createElement('a');
    link.download = `mask_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    selectedShapes = wasSelected;
    currentTool = oldTool;
    draw();
});

const bgImageUpload = document.getElementById('bgImageUpload');
const btnRemoveImage = document.getElementById('btnRemoveImage');
btnRemoveImage.addEventListener('click', () => {
    bgImage = null; bgImageUpload.value = ''; btnRemoveImage.style.display = 'none'; draw();
});
bgImageUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => { bgImage = img; btnRemoveImage.style.display = 'block'; draw(); };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});
document.getElementById('bgImageOpacity').addEventListener('input', (e) => {
    bgOpacity = parseFloat(e.target.value);
    document.getElementById('bgImageOpacityVal').textContent = Math.round(bgOpacity * 100) + "%";
    draw();
});
document.getElementById('btnSaveJSON').addEventListener('click', () => {
    const data = { shapes, shrinkwrapShape, bgColor, floorVisible, panOffsetX, panOffsetY, blockLibrary };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `project_${Date.now()}.json`;
    link.click();
});
document.getElementById('jsonUpload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            shapes = data.shapes || [];
            shrinkwrapShape = data.shrinkwrapShape || null;
            bgColor = data.bgColor || 255;
            floorVisible = data.floorVisible || false;
            panOffsetX = data.panOffsetX || 0;
            panOffsetY = data.panOffsetY || 0;
            blockLibrary = data.blockLibrary || {};
            document.getElementById('bgColor').value = bgColor;
            if (floorVisible) { btnFloor.title = "Remove Floor Plane"; btnFloor.classList.add('active'); } 
            else { btnFloor.title = "Add Floor Plane"; btnFloor.classList.remove('active'); }
            selectedShapes = []; saveState(); draw();
        } catch (err) { alert("Error parsing JSON file"); }
    };
    reader.readAsText(file);
});

// Snapping logich
function getSnapPoint(mx, my) {
    const snapDist = 10;
    for (let s of shapes) {
        if (selectedShapes.includes(s)) continue;
        if (s.type === 'shape' || s.type === 'rect') {
            const pts = [
                {x: s.x - s.w/2, y: s.y - s.h/2}, {x: s.x + s.w/2, y: s.y - s.h/2},
                {x: s.x - s.w/2, y: s.y + s.h/2}, {x: s.x + s.w/2, y: s.y + s.h/2}
            ];
            for (let p of pts) if (Math.hypot(mx - p.x, my - p.y) < snapDist) return p;
        } else if (s.type === 'poly' || s.type === 'curve') {
            for (let p of s.vertices) if (Math.hypot(mx - p.x, my - p.y) < snapDist) return p;
        }
    }
    return {x: mx, y: my};
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { mx: e.clientX - rect.left - panOffsetX, my: e.clientY - rect.top - panOffsetY };
}

// Canvas Interaction
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    let mx = e.clientX - rect.left - panOffsetX;
    let my = e.clientY - rect.top - panOffsetY;
    
    if (currentTool === 'PAN') {
        isPanning = true; dragOffsetX = e.clientX - panOffsetX; dragOffsetY = e.clientY - panOffsetY;
        canvas.style.cursor = 'grabbing'; return;
    }

    if (currentTool === 'CALIBRATE') {
        calibrateStart = getSnapPoint(mx, my);
        return;
    }

    if (currentTool === 'POLY' || currentTool === 'CURVE') {
        const snap = getSnapPoint(mx, my);
        if (currentPolyVertices.length > 2 && Math.hypot(snap.x - currentPolyVertices[0].x, snap.y - currentPolyVertices[0].y) < 15) {
            shapes.push({ type: currentTool === 'POLY' ? 'poly' : 'curve', vertices: [...currentPolyVertices], fillColor: currentClassColor });
            currentPolyVertices = [];
            if (shrinkwrapActive) updateShrinkwrap();
            saveState();
        } else {
            currentPolyVertices.push(snap);
        }
        draw(); return;
    }

    if (currentTool === 'SHAPE') {
        isDrawingShape = true; drawStartX = getSnapPoint(mx, my).x; drawStartY = getSnapPoint(mx, my).y; return;
    }

    if (currentTool === 'TRANSFORM' && selectedShapes.length > 0) {
        if (!currentTransformType.startsWith('array_')) {
            if (currentTransformType === 'copy') {
                let newlySelected = [];
                selectedShapes.forEach(s => {
                    let clone = JSON.parse(JSON.stringify(s));
                    if (clone.type === 'shape' || clone.type === 'rect') { clone.x += 30; clone.y += 30; }
                    else if (clone.type === 'poly' || clone.type === 'curve') { clone.vertices.forEach(v => {v.x+=30;v.y+=30;}); }
                    shapes.push(clone); newlySelected.push(clone); 
                });
                selectedShapes = newlySelected; saveState(); draw(); return;
            }
            
            let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
            selectedShapes.forEach((s, idx) => {
                s = deepConvertToPoly(s); 
                let i = shapes.indexOf(selectedShapes[idx]);
                if(i>-1) shapes[i] = s;
                selectedShapes[idx] = s;
                
                let b = getShapeBounds(s);
                if (b.minX < minX) minX = b.minX; if (b.maxX > maxX) maxX = b.maxX;
                if (b.minY < minY) minY = b.minY; if (b.maxY > maxY) maxY = b.maxY;
            });
            transformPivot = {x: (minX+maxX)/2, y: (minY+maxY)/2};
            
            if (currentTransformType === 'mirror') {
                const mirrorDeep = (shape) => {
                    if (shape.type === 'group') shape.children.forEach(c => mirrorDeep(c));
                    else shape.vertices.forEach(v => v.x = transformPivot.x - (v.x - transformPivot.x));
                };
                selectedShapes.forEach(s => mirrorDeep(s));
                saveState(); draw(); return;
            }

            transformActive = true;
            transformOriginalPoly = JSON.parse(JSON.stringify(selectedShapes));
            transformStartAngle = Math.atan2(my - transformPivot.y, mx - transformPivot.x);
            transformStartMouse = {x: mx, y: my};
            return;
        }
    }

    if (currentTool === 'SELECT') {
        let clickedShape = null;
        let hitHandle = null;

        if (selectedShapes.length === 1 && !selectedShapes[0].isShrinkwrap) {
            let s = selectedShapes[0];
            if (s.type === 'shape' || s.type === 'rect') hitHandle = getResizeCorner(s, mx, my);
            else if (s.type === 'poly' || s.type === 'curve') {
                for(let v=0; v<s.vertices.length; v++) if (Math.hypot(mx - s.vertices[v].x, my - s.vertices[v].y) < 8) { hitHandle = "v"+v; break; }
            }
            if (hitHandle) {
                if (hitHandle.startsWith('v')) selectedNodeIndex = parseInt(hitHandle.substring(1));
                else selectedNodeIndex = -1;
                resizing = true; resizeCorner = hitHandle; return;
            }
            
            if (s.type === 'poly' || s.type === 'curve') {
                for(let i=0; i<s.vertices.length; i++) {
                    let v1 = s.vertices[i]; let v2 = s.vertices[(i+1)%s.vertices.length];
                    if (v2.moveTo || v1.moveTo) continue;
                    let l2 = Math.pow(v1.x - v2.x, 2) + Math.pow(v1.y - v2.y, 2);
                    if (l2 === 0) continue;
                    let t = Math.max(0, Math.min(1, ((rawMx - v1.x) * (v2.x - v1.x) + (rawMy - v1.y) * (v2.y - v1.y)) / l2));
                    let projX = v1.x + t * (v2.x - v1.x); let projY = v1.y + t * (v2.y - v1.y);
                    if (Math.hypot(rawMx - projX, rawMy - projY) < 5) {
                        s.vertices.splice(i+1, 0, {x: projX, y: projY});
                        selectedNodeIndex = i+1; resizing = true; resizeCorner = "v" + (i+1);
                        saveState(); draw(); return;
                    }
                }
            }
        }
        
        for (let i = shapes.length - 1; i >= 0; i--) {
            if (hitTest(shapes[i], mx, my)) { clickedShape = shapes[i]; break; }
        }
        if (!clickedShape && shrinkwrapShape && hitTest(shrinkwrapShape, mx, my)) clickedShape = shrinkwrapShape;
        
        if (clickedShape) {
            if (e.shiftKey) {
                let idx = selectedShapes.indexOf(clickedShape);
                if (idx > -1) selectedShapes.splice(idx, 1);
                else selectedShapes.push(clickedShape);
            } else {
                if (!selectedShapes.includes(clickedShape)) selectedShapes = [clickedShape];
            }
            isDragging = true;
            dragStartPoint = {x: mx, y: my};
        } else {
            selectedShapes = [];
            selectedNodeIndex = -1;
            isMarquee = true;
            marqueeStart = {x: mx, y: my};
            marqueeCurrent = {x: mx, y: my};
        }
        
        const selColor = document.getElementById('semanticColor');
        if (selectedShapes.length > 0 && !selectedShapes[0].isShrinkwrap) {
            selColor.value = selectedShapes[0].fillColor; currentClassColor = selectedShapes[0].fillColor;
        }
        updatePropertiesPanel(); draw();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    let rawMx = e.clientX - rect.left - panOffsetX;
    let rawMy = e.clientY - rect.top - panOffsetY;
    let snap = getSnapPoint(rawMx, rawMy);
    let mx = e.shiftKey ? rawMx : snap.x; 
    let my = e.shiftKey ? rawMy : snap.y;

    if (isPanning) {
        panOffsetX = e.clientX - dragOffsetX; panOffsetY = e.clientY - dragOffsetY; draw(); return;
    }

    if (currentTool === 'CALIBRATE' && calibrateStart) {
        draw();
        ctx.beginPath(); ctx.moveTo(calibrateStart.x, calibrateStart.y); ctx.lineTo(mx, my);
        ctx.strokeStyle = '#ff00ff'; ctx.lineWidth = 2; ctx.stroke();
        let dist = Math.hypot(mx - calibrateStart.x, my - calibrateStart.y);
        ctx.fillStyle = '#ff00ff'; ctx.font = "14px Arial";
        ctx.fillText(`${Math.round(dist)} px`, mx + 10, my - 10);
        return;
    }

    if (isDrawingShape) {
        draw(); 
        ctx.fillStyle = currentClassColor; ctx.globalAlpha = 0.5;
        let rw = Math.abs(mx - drawStartX), rh = Math.abs(my - drawStartY);
        let rx = drawStartX + (mx - drawStartX)/2, ry = drawStartY + (my - drawStartY)/2;
        drawShapePrimitive(ctx, currentShapeType, rx, ry, rw, rh);
        ctx.globalAlpha = 1.0; return;
    }

    if ((currentTool === 'POLY' || currentTool === 'CURVE') && currentPolyVertices.length > 0) {
        draw();
        let pts = [...currentPolyVertices, {x: mx, y: my}];
        if (currentTool === 'CURVE') pts = chaikinOpen(pts, 4);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
        return;
    }

    if (transformActive && selectedShapes.length > 0) {
        let currentAngle = Math.atan2(my - transformPivot.y, mx - transformPivot.x);
        let dTheta = currentAngle - transformStartAngle;
        let dxMouse = mx - transformStartMouse.x;
        
        const applyTransformDeep = (s, orig, cType) => {
            if (s.type === 'group') {
                s.children.forEach((c, idx) => applyTransformDeep(c, orig.children[idx], cType));
            } else {
                for(let i=0; i<s.vertices.length; i++) {
                    let ov = orig.vertices[i];
                    if (cType === 'rotate') {
                        let dx = ov.x - transformPivot.x, dy = ov.y - transformPivot.y;
                        s.vertices[i].x = transformPivot.x + dx*Math.cos(dTheta) - dy*Math.sin(dTheta);
                        s.vertices[i].y = transformPivot.y + dx*Math.sin(dTheta) + dy*Math.cos(dTheta);
                    } else if (cType === 'shear') {
                        let factor = (ov.y - transformPivot.y) / 50; 
                        s.vertices[i].x = ov.x + dxMouse * factor;
                        s.vertices[i].y = ov.y;
                    }
                }
            }
        };

        selectedShapes.forEach((s, shapeIdx) => {
            applyTransformDeep(s, transformOriginalPoly[shapeIdx], currentTransformType);
        });
        if (shrinkwrapActive) updateShrinkwrap();
        draw(); return;
    }

    if (currentTool === 'SELECT') {
        if (resizing && selectedShapes.length === 1) {
            let s = selectedShapes[0];
            if (s.type === 'shape' || s.type === 'rect') resizeShape(s, mx, my, resizeCorner);
            else if (s.type === 'poly' || s.type === 'curve') {
                let vIdx = parseInt(resizeCorner.substring(1));
                s.vertices[vIdx].x = mx; s.vertices[vIdx].y = my;
            }
            if (shrinkwrapActive) updateShrinkwrap();
            updatePropertiesPanel(); draw();
        } else if (isDragging && selectedShapes.length > 0) {
            let dx = mx - dragStartPoint.x;
            let dy = my - dragStartPoint.y;
        selectedShapes.forEach(s => {
                translateShape(s, dx, dy);
            });
            dragStartPoint = {x: mx, y: my};
            if (shrinkwrapActive) updateShrinkwrap();
            updatePropertiesPanel(); draw();
        } else if (isMarquee) {
            marqueeCurrent = {x: mx, y: my};
            let minX = Math.min(marqueeStart.x, marqueeCurrent.x);
            let maxX = Math.max(marqueeStart.x, marqueeCurrent.x);
            let minY = Math.min(marqueeStart.y, marqueeCurrent.y);
            let maxY = Math.max(marqueeStart.y, marqueeCurrent.y);
            
            selectedShapes = shapes.filter(s => {
                let b = getShapeBounds(s);
                return !(b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY);
            });
            draw();
        } else {
            let hoveringHndl = false, hoveringShape = false;
            if (selectedShapes.length === 1 && !selectedShapes[0].isShrinkwrap) {
                let s = selectedShapes[0];
                if (s.type === 'shape' || s.type === 'rect') { if(getResizeCorner(s, rawMx, rawMy)) hoveringHndl=true; }
                else if (s.type === 'poly' || s.type === 'curve') {
                    for(let v=0; v<s.vertices.length; v++) if (Math.hypot(rawMx - s.vertices[v].x, rawMy - s.vertices[v].y) < 8) hoveringHndl = true;
                }
            }
            if (!hoveringHndl) {
                for (let i = shapes.length - 1; i >= 0; i--) if (hitTest(shapes[i], rawMx, rawMy)) { hoveringShape = true; break; }
            }
            if (hoveringHndl) canvas.style.cursor = 'crosshair';
            else if (hoveringShape) canvas.style.cursor = 'move';
            else canvas.style.cursor = 'default';
        }
    }
});

window.addEventListener('mouseup', (e) => {
    if (isPanning) { isPanning = false; canvas.style.cursor = 'grab'; }
    if (currentTool === 'CALIBRATE' && calibrateStart) {
        const rect = canvas.getBoundingClientRect();
        let rawMx = e.clientX - rect.left - panOffsetX, rawMy = e.clientY - rect.top - panOffsetY;
        let snap = getSnapPoint(rawMx, rawMy);
        let mx = e.shiftKey ? rawMx : snap.x, my = e.shiftKey ? rawMy : snap.y;
        let dist = Math.hypot(mx - calibrateStart.x, my - calibrateStart.y);
        if (dist > 10) {
            let userVal = prompt(`Line is ${Math.round(dist)} pixels.\nEnter actual length and unit (e.g. '0.9 m' or '12 ft'):`);
            if (userVal) {
                let match = userVal.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?$/);
                if (match) {
                    let val = parseFloat(match[1]);
                    if (val > 0) {
                        pixelsPerUnit = dist / val;
                        currentUnit = match[2] || "units";
                        updatePropertiesPanel();
                    }
                }
            }
        }
        calibrateStart = null; setTool('SELECT'); return;
    }
    if (isDrawingShape) {
        const rect = canvas.getBoundingClientRect();
        let rawMx = e.clientX - rect.left - panOffsetX, rawMy = e.clientY - rect.top - panOffsetY;
        let snap = getSnapPoint(rawMx, rawMy);
        let mx = e.shiftKey ? rawMx : snap.x, my = e.shiftKey ? rawMy : snap.y;
        let w = Math.abs(mx - drawStartX), h = Math.abs(my - drawStartY);
        if (w > 10 && h > 10) {
            shapes.push({ type: 'shape', subType: currentShapeType, x: drawStartX + (mx - drawStartX)/2, y: drawStartY + (my - drawStartY)/2, w: w, h: h, fillColor: currentClassColor });
            if (shrinkwrapActive) updateShrinkwrap();
            saveState();
        }
        isDrawingShape = false; draw();
    }
    if (transformActive) { transformActive = false; saveState(); }
    if (resizing || isDragging || isMarquee) { 
        resizing = false; isDragging = false; isMarquee = false; 
        saveState(); draw(); 
    }
});

function getResizeCorner(s, mx, my) {
    if (s.isShrinkwrap) return null;
    const tol = 12;
    const dist = (x1, y1, x2, y2) => Math.hypot(x2-x1, y2-y1);
    if (dist(mx, my, s.x - s.w/2, s.y - s.h/2) < tol) return "top-left";
    if (dist(mx, my, s.x + s.w/2, s.y - s.h/2) < tol) return "top-right";
    if (dist(mx, my, s.x - s.w/2, s.y + s.h/2) < tol) return "bottom-left";
    if (dist(mx, my, s.x + s.w/2, s.y + s.h/2) < tol) return "bottom-right";
    return null;
}

function resizeShape(s, mx, my, corner) {
    let minSize = 10;
    let oldX = s.x, oldY = s.y, oldW = s.w, oldH = s.h;
    switch (corner) {
        case "top-left":
            s.w = (oldX + oldW/2) - mx; s.h = (oldY + oldH/2) - my;
            if (s.w > minSize) s.x = mx + s.w/2; else s.w = minSize;
            if (s.h > minSize) s.y = my + s.h/2; else s.h = minSize; break;
        case "top-right":
            s.w = mx - (oldX - oldW/2); s.h = (oldY + oldH/2) - my;
            if (s.w > minSize) s.x = (oldX - oldW/2) + s.w/2; else s.w = minSize;
            if (s.h > minSize) s.y = my + s.h/2; else s.h = minSize; break;
        case "bottom-left":
            s.w = (oldX + oldW/2) - mx; s.h = my - (oldY - oldH/2);
            if (s.w > minSize) s.x = mx + s.w/2; else s.w = minSize;
            if (s.h > minSize) s.y = (oldY - oldH/2) + s.h/2; else s.h = minSize; break;
        case "bottom-right":
            s.w = mx - (oldX - oldW/2); s.h = my - (oldY - oldH/2);
            if (s.w > minSize) s.x = (oldX - oldW/2) + s.w/2; else s.w = minSize;
            if (s.h > minSize) s.y = (oldY - oldH/2) + s.h/2; else s.h = minSize; break;
    }
}

function ptInConvexPolygon(px, py, vertices) {
    if (!vertices || vertices.length < 3) return false;
    let crossProduct = (a, b, c) => (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
    let initialSign = crossProduct(vertices[0], vertices[1], {x: px, y: py}) > 0;
    for (let i = 1; i < vertices.length; i++) {
        let nxt = (i+1)%vertices.length;
        let sign = crossProduct(vertices[i], vertices[nxt], {x: px, y: py}) > 0;
        if (sign !== initialSign) return false;
    }
    return true;
}

function updateShrinkwrap() {
    if (!shrinkwrapShape || shapes.length < 3) return;
    let envelopePoints = [];
    shapes.forEach(s => {
        if (s.type === 'shape' || s.type === 'rect') {
            envelopePoints.push({x: s.x - s.w/2 - shrinkwrapOffset, y: s.y - s.h/2 - shrinkwrapOffset});
            envelopePoints.push({x: s.x + s.w/2 + shrinkwrapOffset, y: s.y - s.h/2 - shrinkwrapOffset});
            envelopePoints.push({x: s.x - s.w/2 - shrinkwrapOffset, y: s.y + s.h/2 + shrinkwrapOffset});
            envelopePoints.push({x: s.x + s.w/2 + shrinkwrapOffset, y: s.y + s.h/2 + shrinkwrapOffset});
        }
        if (s.type === 'poly' || s.type === 'curve') {
            s.vertices.forEach(v => {
                envelopePoints.push({x: v.x - shrinkwrapOffset, y: v.y - shrinkwrapOffset});
                envelopePoints.push({x: v.x + shrinkwrapOffset, y: v.y + shrinkwrapOffset});
            });
        }
    });
    shrinkwrapShape.vertices = computeConvexHull(envelopePoints); draw();
}

function computeConvexHull(points) {
    if (points.length < 3) return points;
    points.sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
    const crossProduct = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    let lower = [];
    for (let i = 0; i < points.length; i++) {
        while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], points[i]) <= 0) lower.pop();
        lower.push(points[i]);
    }
    let upper = [];
    for (let i = points.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], points[i]) <= 0) upper.pop();
        upper.push(points[i]);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
}

function drawShapePrimitive(ctx, type, cx, cy, w, h) {
    let dx = cx - w/2; let dy = cy - h/2;
    ctx.beginPath();
    if (type === 'rect') ctx.rect(dx, dy, w, h);
    else if (type === 'ellipse') ctx.ellipse(cx, cy, w/2, h/2, 0, 0, Math.PI*2);
    else if (type === 'round_rect') ctx.roundRect(dx, dy, w, h, Math.min(w, h) * 0.15);
    else if (type === 'triangle') { ctx.moveTo(cx, dy); ctx.lineTo(dx + w, dy + h); ctx.lineTo(dx, dy + h); }
    else if (type === 'diamond') { ctx.moveTo(cx, dy); ctx.lineTo(dx + w, cy); ctx.lineTo(cx, dy + h); ctx.lineTo(dx, cy); }
    else if (type === 'trapezoid') { let inset = w * 0.25; ctx.moveTo(dx + inset, dy); ctx.lineTo(dx + w - inset, dy); ctx.lineTo(dx + w, dy + h); ctx.lineTo(dx, dy + h); }
    else if (type === 'human') {
        const r = Math.min(w,h) * 0.15; ctx.arc(cx, dy + r, r, 0, Math.PI*2); ctx.moveTo(cx - w*0.25, dy + r*2.5);
        ctx.quadraticCurveTo(cx, dy + r*1.8, cx + w*0.25, dy + r*2.5); ctx.lineTo(cx + w*0.2, dy + h); ctx.lineTo(cx + w*0.05, dy + h);
        ctx.lineTo(cx, dy + h*0.6); ctx.lineTo(cx - w*0.05, dy + h); ctx.lineTo(cx - w*0.2, dy + h); ctx.lineTo(cx - w*0.25, dy + r*2.5);
    }
    ctx.closePath(); ctx.fill();
}

function drawShapeNode(ctx, s, isExport) {
    if (s.type === 'group') {
        s.children.forEach(c => drawShapeNode(ctx, c, isExport));
        return;
    }
    if (s.type === 'blockRef') {
        let master = blockLibrary[s.blockId];
        if (master) {
            ctx.save(); ctx.translate(s.x, s.y);
            master.children.forEach(c => drawShapeNode(ctx, c, isExport));
            ctx.restore();
        }
        return;
    }
    ctx.fillStyle = s.fillColor; ctx.globalAlpha = isExport ? 1.0 : 0.85;
    if (s.type === 'shape' || s.type === 'rect') {
        drawShapePrimitive(ctx, s.subType || 'rect', s.x, s.y, s.w, s.h);
    } else if ((s.type === 'poly' || s.type === 'curve') && s.vertices.length > 0) {
        ctx.beginPath();
        let pts = s.type === 'curve' ? chaikinClosed(s.vertices, 4) : s.vertices;
        pts.forEach((v, i) => {
            if (i === 0 || v.moveTo) ctx.moveTo(v.x, v.y);
            else ctx.lineTo(v.x, v.y);
        });
        ctx.closePath(); ctx.fill('evenodd');
    }
    ctx.globalAlpha = 1.0;
}

function draw() {
    ctx.fillStyle = `rgb(${bgColor}, ${bgColor}, ${bgColor})`; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (bgImage) {
        ctx.globalAlpha = bgOpacity; const scale = Math.min(canvas.width / bgImage.width, canvas.height / bgImage.height);
        ctx.drawImage(bgImage, panOffsetX, panOffsetY, bgImage.width * scale, bgImage.height * scale); ctx.globalAlpha = 1.0;
    }
    
    ctx.save(); ctx.translate(panOffsetX, panOffsetY);
    if (floorVisible) { ctx.fillStyle = "#FFFF00"; ctx.globalAlpha = currentTool === "EXPORTING" ? 1.0 : 0.8; ctx.fillRect(-panOffsetX, (canvas.height - panOffsetY) * 0.9, canvas.width, canvas.height * 0.1); ctx.globalAlpha = 1.0; }
    if (shrinkwrapShape && shrinkwrapShape.vertices.length > 0) {
        ctx.fillStyle = shrinkwrapShape.fillColor; ctx.beginPath(); ctx.moveTo(shrinkwrapShape.vertices[0].x, shrinkwrapShape.vertices[0].y);
        for (let i = 1; i < shrinkwrapShape.vertices.length; i++) ctx.lineTo(shrinkwrapShape.vertices[i].x, shrinkwrapShape.vertices[i].y);
        ctx.closePath(); ctx.globalAlpha = currentTool === "EXPORTING" ? 1.0 : 0.4; ctx.fill(); ctx.globalAlpha = 1.0;
        if (selectedShapes.includes(shrinkwrapShape) && currentTool !== "EXPORTING") { ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); }
    }
    
    for (let s of shapes) {
        drawShapeNode(ctx, s, currentTool === "EXPORTING");
        
        if (selectedShapes.includes(s) && currentTool !== "EXPORTING") {
            ctx.fillStyle = "white"; ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1;
            const drawHndl = (hx, hy) => { ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
            
            if (s.type === 'group' || s.type === 'blockRef') {
                let b = getShapeBounds(s);
                ctx.strokeStyle = s.type === 'blockRef' ? "rgba(255,100,200,0.8)" : "rgba(100,200,255,0.8)"; 
                ctx.setLineDash([4, 4]); ctx.strokeRect(b.minX, b.minY, b.maxX-b.minX, b.maxY-b.minY); ctx.setLineDash([]);
            } else if (s.type === 'shape' || s.type === 'rect') {
                if (selectedShapes.length === 1) {
                    drawHndl(s.x - s.w/2, s.y - s.h/2); drawHndl(s.x + s.w/2, s.y - s.h/2); drawHndl(s.x - s.w/2, s.y + s.h/2); drawHndl(s.x + s.w/2, s.y + s.h/2);
                }
                ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.setLineDash([4, 4]); ctx.strokeRect(s.x - s.w/2, s.y - s.h/2, s.w, s.h); ctx.setLineDash([]);
            } else if (s.type === 'poly' || s.type === 'curve') {
                if (selectedShapes.length === 1) {
                    s.vertices.forEach((v, i) => {
                        ctx.fillStyle = i === selectedNodeIndex ? "#FF3366" : "white";
                        drawHndl(v.x, v.y);
                    });
                }
                ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.setLineDash([4, 4]); ctx.beginPath();
                s.vertices.forEach((v, i) => {
                    if (i === 0 || v.moveTo) ctx.moveTo(v.x, v.y);
                    else ctx.lineTo(v.x, v.y);
                });
                if (s.type === 'poly' || s.type === 'curve') ctx.closePath();
                ctx.stroke(); ctx.setLineDash([]);
            }
        }
    }
    if (currentPolyVertices.length > 0 && currentTool !== "EXPORTING") {
        ctx.strokeStyle = '#2d5aff'; ctx.lineWidth = 2; ctx.beginPath();
        let pts = currentTool === 'CURVE' ? chaikinOpen(currentPolyVertices, 4) : currentPolyVertices;
        ctx.moveTo(pts[0].x, pts[0].y);
        for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
    }

    if (isMarquee && currentTool === 'SELECT') {
        ctx.fillStyle = "rgba(0, 120, 255, 0.1)";
        ctx.strokeStyle = "rgba(0, 120, 255, 0.8)";
        ctx.lineWidth = 1;
        let minX = Math.min(marqueeStart.x, marqueeCurrent.x);
        let minY = Math.min(marqueeStart.y, marqueeCurrent.y);
        let w = Math.abs(marqueeCurrent.x - marqueeStart.x);
        let h = Math.abs(marqueeCurrent.y - marqueeStart.y);
        ctx.fillRect(minX, minY, w, h);
        ctx.strokeRect(minX, minY, w, h);
    }

    ctx.restore();
}

function resizeCanvas() {
    canvas.width = document.getElementById('canvas-wrapper').clientWidth;
    canvas.height = document.getElementById('canvas-wrapper').clientHeight;
    draw();
}
window.addEventListener('resize', resizeCanvas); resizeCanvas(); 

// --- AI Generation Logic ---
const btnGenerateAI = document.getElementById('btnGenerateAI');
const aiPrompt = document.getElementById('aiPrompt');
const aiStyle = document.getElementById('aiStyle');
const aiLoading = document.getElementById('aiLoading');
const comparisonModal = document.getElementById('comparisonModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const imgOriginal = document.getElementById('imgOriginal');
const imgGenerated = document.getElementById('imgGenerated');
const btnDownloadResult = document.getElementById('btnDownloadResult');

let currentGeneratedUrl = null;

btnGenerateAI.addEventListener('click', async () => {
    const promptText = aiPrompt.value.trim();
    if (!promptText) {
        alert("Please enter a prompt describing the design.");
        return;
    }

    const wasSelected = selectedShape;
    selectedShape = null;
    let oldTool = currentTool;
    currentTool = "EXPORTING"; 
    draw(); 
    const imageBase64 = canvas.toDataURL('image/png');
    selectedShape = wasSelected;
    currentTool = oldTool;
    draw();

    btnGenerateAI.disabled = true;
    aiLoading.style.display = 'block';

    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                imageBase64: imageBase64,
                userPrompt: promptText,
                style: aiStyle.value,
                controlMode: 'canny'
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to generate image');
        }

        if (data.imageUrl) {
            currentGeneratedUrl = data.imageUrl;
            imgOriginal.src = imageBase64;
            imgGenerated.src = data.imageUrl;
            comparisonModal.classList.add('active');
        } else {
            throw new Error('No image URL returned.');
        }

    } catch (err) {
        console.error("Generation Error:", err);
        alert("Generation failed: " + err.message);
    } finally {
        btnGenerateAI.disabled = false;
        aiLoading.style.display = 'none';
    }
});

btnCloseModal.addEventListener('click', () => {
    comparisonModal.classList.remove('active');
});

btnDownloadResult.addEventListener('click', async () => {
    if (!currentGeneratedUrl) return;
    try {
        const response = await fetch(currentGeneratedUrl);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ai_exterior_${Date.now()}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch(err) {
        window.open(currentGeneratedUrl, '_blank');
    }
});
