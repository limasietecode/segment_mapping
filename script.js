const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');

let shapes = [];
let historyStack = [];
let historyIndex = -1;

let currentTool = "SELECT"; // SELECT, RECT, POLY, PAN
let floorVisible = false;
let shrinkwrapOffset = 10;
let shrinkwrapShape = null;

let bgImage = null;
let bgOpacity = 0.5;
let bgColor = 255;
let currentClassColor = "#FF0000";

let selectedShape = null;
let resizing = false;
let resizeCorner = "";
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let shrinkwrapActive = false;

// Pan state
let panOffsetX = 0;
let panOffsetY = 0;
let isPanning = false;

// Drawing state
let isDrawingRect = false;
let drawStartX = 0;
let drawStartY = 0;
let currentPolyVertices = [];

function saveState() {
    historyStack = historyStack.slice(0, historyIndex + 1);
    const clone = JSON.parse(JSON.stringify({shapes: shapes, shrinkwrapShape: shrinkwrapShape}));
    historyStack.push(clone);
    historyIndex++;
}
saveState();

// Undo/Redo & Shortcuts
window.addEventListener('keydown', (e) => {
    if (selectedShape && e.key === '[') {
        const idx = shapes.indexOf(selectedShape);
        if (idx > 0) {
            shapes.splice(idx, 1);
            shapes.splice(idx - 1, 0, selectedShape);
            saveState();
            draw();
        }
    }
    if (selectedShape && e.key === ']') {
        const idx = shapes.indexOf(selectedShape);
        if (idx > -1 && idx < shapes.length - 1) {
            shapes.splice(idx, 1);
            shapes.splice(idx + 1, 0, selectedShape);
            saveState();
            draw();
        }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShape) {
        if (selectedShape.isShrinkwrap) {
            shrinkwrapShape = null;
            shrinkwrapActive = false;
            document.getElementById('btnShrinkwrap').title = "Compute Shrinkwrap";
            document.getElementById('btnShrinkwrap').classList.remove('active');
        } else {
            const idx = shapes.indexOf(selectedShape);
            if (idx > -1) shapes.splice(idx, 1);
            if (shrinkwrapActive) updateShrinkwrap();
        }
        selectedShape = null;
        updatePropertiesPanel();
        saveState();
        draw();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        if (historyIndex > 0) {
            historyIndex--;
            const state = historyStack[historyIndex];
            shapes = JSON.parse(JSON.stringify(state.shapes));
            shrinkwrapShape = state.shrinkwrapShape ? JSON.parse(JSON.stringify(state.shrinkwrapShape)) : null;
            selectedShape = null;
            updatePropertiesPanel();
            draw();
        }
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        if (historyIndex < historyStack.length - 1) {
            historyIndex++;
            const state = historyStack[historyIndex];
            shapes = JSON.parse(JSON.stringify(state.shapes));
            shrinkwrapShape = state.shrinkwrapShape ? JSON.parse(JSON.stringify(state.shrinkwrapShape)) : null;
            selectedShape = null;
            updatePropertiesPanel();
            draw();
        }
    }
    
    // Tools
    if (e.key.toLowerCase() === 'v' && document.activeElement.tagName !== 'INPUT') setTool('SELECT');
    if (e.key.toLowerCase() === 'm' && document.activeElement.tagName !== 'INPUT') setTool('RECT');
    if (e.key.toLowerCase() === 'p' && document.activeElement.tagName !== 'INPUT') setTool('POLY');
    if (e.key.toLowerCase() === 'h' && document.activeElement.tagName !== 'INPUT') setTool('PAN');
});

// Setup Toolbar
document.getElementById('toolSelect').addEventListener('click', () => setTool('SELECT'));
document.getElementById('toolRect').addEventListener('click', () => setTool('RECT'));
document.getElementById('toolPoly').addEventListener('click', () => setTool('POLY'));
document.getElementById('toolPan').addEventListener('click', () => setTool('PAN'));

function setTool(tool) {
    if (currentTool === 'POLY' && currentPolyVertices.length > 2 && tool !== 'POLY') {
        // Complete poly if switching tool
        shapes.push({ type: 'poly', vertices: currentPolyVertices, fillColor: currentClassColor });
        saveState();
        if (shrinkwrapActive) updateShrinkwrap();
    }
    currentPolyVertices = [];
    isDrawingRect = false;

    currentTool = tool;
    document.querySelectorAll('.toolbar-grid button').forEach(b => b.classList.remove('active'));
    
    if (tool === 'SELECT') document.getElementById('toolSelect').classList.add('active');
    if (tool === 'RECT') document.getElementById('toolRect').classList.add('active');
    if (tool === 'POLY') document.getElementById('toolPoly').classList.add('active');
    if (tool === 'PAN') document.getElementById('toolPan').classList.add('active');
    
    canvas.style.cursor = tool === 'PAN' ? 'grab' : (tool === 'POLY' ? 'crosshair' : 'default');
    
    if (tool !== 'SELECT') {
        selectedShape = null;
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
        if (selectedShape && selectedShape.type === 'rect') {
            selectedShape.x = parseFloat(propX.value);
            selectedShape.y = parseFloat(propY.value);
            selectedShape.w = parseFloat(propW.value);
            selectedShape.h = parseFloat(propH.value);
            if (shrinkwrapActive) updateShrinkwrap();
            saveState();
            draw();
        }
    });
});

function updatePropertiesPanel() {
    if (selectedShape && selectedShape.type === 'rect') {
        propsContainer.style.display = 'block';
        propX.value = Math.round(selectedShape.x);
        propY.value = Math.round(selectedShape.y);
        propW.value = Math.round(selectedShape.w);
        propH.value = Math.round(selectedShape.h);
    } else {
        propsContainer.style.display = 'none';
    }
}

// Setup Standard UI Listeners
document.getElementById('semanticColor').addEventListener('change', (e) => {
    currentClassColor = e.target.value;
    if (selectedShape) {
        selectedShape.fillColor = currentClassColor;
        saveState();
        draw();
    }
});
document.getElementById('bgColor').addEventListener('input', (e) => {
    bgColor = parseInt(e.target.value);
    draw();
});
document.getElementById('shrinkOffset').addEventListener('input', (e) => {
    document.getElementById('shrinkOffsetVal').textContent = e.target.value;
    shrinkwrapOffset = parseInt(e.target.value);
    if (shrinkwrapActive) updateShrinkwrap();
});
const btnFloor = document.getElementById('btnFloor');
btnFloor.addEventListener('click', () => {
    floorVisible = !floorVisible;
    if(floorVisible) btnFloor.classList.add('active');
    else btnFloor.classList.remove('active');
    btnFloor.title = floorVisible ? "Remove Floor Plane" : "Add Floor Plane";
    draw();
});
const btnShrinkwrap = document.getElementById('btnShrinkwrap');
btnShrinkwrap.addEventListener('click', () => {
    shrinkwrapActive = !shrinkwrapActive;
    if (shrinkwrapActive) {
        if (shapes.length < 3) {
            shrinkwrapActive = false; return;
        }
        shrinkwrapShape = { isShrinkwrap: true, fillColor: currentClassColor, vertices: [] };
        updateShrinkwrap();
        btnShrinkwrap.title = "Remove Shrinkwrap";
        btnShrinkwrap.classList.add('active');
        saveState();
    } else {
        shrinkwrapShape = null;
        btnShrinkwrap.title = "Compute Shrinkwrap";
        btnShrinkwrap.classList.remove('active');
        saveState();
        draw();
    }
});
document.getElementById('btnExportPNG').addEventListener('click', () => {
    const wasSelected = selectedShape;
    selectedShape = null;
    let oldTool = currentTool;
    currentTool = "EXPORTING"; // forces solid opacity rendering
    draw(); 
    const link = document.createElement('a');
    link.download = `mask_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    selectedShape = wasSelected;
    currentTool = oldTool;
    draw();
});

const bgImageUpload = document.getElementById('bgImageUpload');
const btnRemoveImage = document.getElementById('btnRemoveImage');
btnRemoveImage.addEventListener('click', () => {
    bgImage = null;
    bgImageUpload.value = '';
    btnRemoveImage.style.display = 'none';
    draw();
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
    const data = { shapes, shrinkwrapShape, bgColor, floorVisible, panOffsetX, panOffsetY };
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
            document.getElementById('bgColor').value = bgColor;
            if (floorVisible) {
                btnFloor.title = "Remove Floor Plane";
                btnFloor.classList.add('active');
            } else {
                btnFloor.title = "Add Floor Plane";
                btnFloor.classList.remove('active');
            }
            selectedShape = null;
            saveState();
            draw();
        } catch (err) { alert("Error parsing JSON file"); }
    };
    reader.readAsText(file);
});

// Snapping logich
function getSnapPoint(mx, my) {
    const snapDist = 10;
    for (let s of shapes) {
        if (s === selectedShape) continue;
        if (s.type === 'rect') {
            const pts = [
                {x: s.x - s.w/2, y: s.y - s.h/2},
                {x: s.x + s.w/2, y: s.y - s.h/2},
                {x: s.x - s.w/2, y: s.y + s.h/2},
                {x: s.x + s.w/2, y: s.y + s.h/2}
            ];
            for (let p of pts) {
                if (Math.hypot(mx - p.x, my - p.y) < snapDist) return p;
            }
        } else if (s.type === 'poly') {
            for (let p of s.vertices) {
                if (Math.hypot(mx - p.x, my - p.y) < snapDist) return p;
            }
        }
    }
    return {x: mx, y: my}; // No snap
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        mx: e.clientX - rect.left - panOffsetX,
        my: e.clientY - rect.top - panOffsetY
    };
}

// Canvas Interaction
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    let mx = e.clientX - rect.left - panOffsetX;
    let my = e.clientY - rect.top - panOffsetY;
    
    if (currentTool === 'PAN') {
        isPanning = true;
        dragOffsetX = e.clientX - panOffsetX;
        dragOffsetY = e.clientY - panOffsetY;
        canvas.style.cursor = 'grabbing';
        return;
    }

    if (currentTool === 'POLY') {
        const snap = getSnapPoint(mx, my);
        // Double click equivalent or close to start
        if (currentPolyVertices.length > 2 && Math.hypot(snap.x - currentPolyVertices[0].x, snap.y - currentPolyVertices[0].y) < 15) {
            shapes.push({ type: 'poly', vertices: [...currentPolyVertices], fillColor: currentClassColor });
            currentPolyVertices = [];
            if (shrinkwrapActive) updateShrinkwrap();
            saveState();
        } else {
            currentPolyVertices.push(snap);
        }
        draw();
        return;
    }

    // Snapping doesn't generally apply to click start of rect, unless we want it to
    const snap = getSnapPoint(mx, my);
    if (currentTool === 'RECT') {
        isDrawingRect = true;
        drawStartX = snap.x;
        drawStartY = snap.y;
        return;
    }

    // SELECT TOOL logic
    let clickedOnShape = false;
    for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (s.type === 'rect') {
            const corner = getResizeCorner(s, mx, my);
            if (corner) {
                selectedShape = s; resizing = true; resizeCorner = corner; clickedOnShape = true; break;
            } else if (mx > s.x - s.w/2 && mx < s.x + s.w/2 && my > s.y - s.h/2 && my < s.y + s.h/2) {
                selectedShape = s; isDragging = true; dragOffsetX = s.x - mx; dragOffsetY = s.y - my; clickedOnShape = true; break;
            }
        } else if (s.type === 'poly') {
            // Check vertex drag
            let vertexClicked = -1;
            for(let v=0; v<s.vertices.length; v++) {
                if (Math.hypot(mx - s.vertices[v].x, my - s.vertices[v].y) < 8) { vertexClicked = v; break; }
            }
            if (vertexClicked > -1) {
                selectedShape = s; resizing = true; resizeCorner = "v" + vertexClicked; clickedOnShape = true; break;
            } else if (ptInConvexPolygon(mx, my, s.vertices)) { // assumes convex for now, or just bounding box
                selectedShape = s; isDragging = true; dragOffsetX = mx; dragOffsetY = my; clickedOnShape = true; break;
            }
        }
    }
    
    // Check shrinkwrap
    if (!clickedOnShape && shrinkwrapShape && ptInConvexPolygon(mx, my, shrinkwrapShape.vertices)) {
       selectedShape = shrinkwrapShape; clickedOnShape = true;
    }
    
    if (!clickedOnShape) {
        selectedShape = null;
    }
    
    const selColor = document.getElementById('semanticColor');
    if (selectedShape && !selectedShape.isShrinkwrap) {
        selColor.value = selectedShape.fillColor;
        currentClassColor = selectedShape.fillColor;
    }
    
    updatePropertiesPanel();
    draw();
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    let rawMx = e.clientX - rect.left - panOffsetX;
    let rawMy = e.clientY - rect.top - panOffsetY;
    let snap = getSnapPoint(rawMx, rawMy);
    let mx = e.shiftKey ? rawMx : snap.x; // Shift forces free move/draw, else snap
    let my = e.shiftKey ? rawMy : snap.y;

    if (isPanning) {
        panOffsetX = e.clientX - dragOffsetX;
        panOffsetY = e.clientY - dragOffsetY;
        draw();
        return;
    }

    if (isDrawingRect) {
        draw(); // redraw existing
        ctx.fillStyle = currentClassColor;
        ctx.globalAlpha = 0.5;
        let rw = mx - drawStartX;
        let rh = my - drawStartY;
        ctx.fillRect(drawStartX, drawStartY, rw, rh);
        ctx.globalAlpha = 1.0;
        return;
    }

    if (currentTool === 'POLY' && currentPolyVertices.length > 0) {
        draw();
        ctx.beginPath();
        ctx.moveTo(currentPolyVertices[currentPolyVertices.length-1].x + panOffsetX, currentPolyVertices[currentPolyVertices.length-1].y + panOffsetY);
        ctx.lineTo(mx + panOffsetX, my + panOffsetY);
        ctx.strokeStyle = '#fff';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
    }

    if (currentTool === 'SELECT') {
        if (resizing && selectedShape) {
            if (selectedShape.type === 'rect') {
                resizeShape(selectedShape, mx, my, resizeCorner);
            } else if (selectedShape.type === 'poly') {
                let vIdx = parseInt(resizeCorner.substring(1));
                selectedShape.vertices[vIdx].x = mx;
                selectedShape.vertices[vIdx].y = my;
            }
            if (shrinkwrapActive) updateShrinkwrap();
            updatePropertiesPanel();
            draw();
        } else if (isDragging && selectedShape && !selectedShape.isShrinkwrap) {
            if (selectedShape.type === 'rect') {
                selectedShape.x = mx + dragOffsetX;
                selectedShape.y = my + dragOffsetY;
            } else if (selectedShape.type === 'poly') {
                let dx = mx - dragOffsetX;
                let dy = my - dragOffsetY;
                selectedShape.vertices.forEach(v => { v.x += dx; v.y += dy; });
                dragOffsetX = mx; dragOffsetY = my;
            }
            if (shrinkwrapActive) updateShrinkwrap();
            updatePropertiesPanel();
            draw();
        } else {
            // Hover logic
            let hoveringHndl = false, hoveringShape = false;
            for (let i = shapes.length - 1; i >= 0; i--) {
                const s = shapes[i];
                if (s.type === 'rect') {
                    if (getResizeCorner(s, rawMx, rawMy)) { hoveringHndl = true; break; }
                    else if (rawMx > s.x - s.w/2 && rawMx < s.x + s.w/2 && rawMy > s.y - s.h/2 && rawMy < s.y + s.h/2) { hoveringShape = true; break; }
                } else if (s.type === 'poly') {
                    for(let v=0; v<s.vertices.length; v++) if (Math.hypot(rawMx - s.vertices[v].x, rawMy - s.vertices[v].y) < 8) { hoveringHndl = true; break; }
                    if (!hoveringHndl && ptInConvexPolygon(rawMx, rawMy, s.vertices)) { hoveringShape = true; break; }
                }
            }
            if (hoveringHndl) canvas.style.cursor = 'crosshair';
            else if (hoveringShape) canvas.style.cursor = 'move';
            else canvas.style.cursor = 'default';
        }
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (isPanning) {
        isPanning = false;
        canvas.style.cursor = 'grab';
    }
    if (isDrawingRect) {
        const rect = canvas.getBoundingClientRect();
        let rawMx = e.clientX - rect.left - panOffsetX;
        let rawMy = e.clientY - rect.top - panOffsetY;
        let snap = getSnapPoint(rawMx, rawMy);
        let mx = e.shiftKey ? rawMx : snap.x;
        let my = e.shiftKey ? rawMy : snap.y;
        
        let w = Math.abs(mx - drawStartX);
        let h = Math.abs(my - drawStartY);
        if (w > 10 && h > 10) {
            shapes.push({
                type: 'rect',
                x: drawStartX + (mx - drawStartX)/2,
                y: drawStartY + (my - drawStartY)/2,
                w: w, h: h,
                fillColor: currentClassColor
            });
            if (shrinkwrapActive) updateShrinkwrap();
            saveState();
        }
        isDrawingRect = false;
        draw();
    }
    if (resizing || isDragging) {
        resizing = false;
        isDragging = false;
        saveState();
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
            if (s.h > minSize) s.y = my + s.h/2; else s.h = minSize;
            break;
        case "top-right":
            s.w = mx - (oldX - oldW/2); s.h = (oldY + oldH/2) - my;
            if (s.w > minSize) s.x = (oldX - oldW/2) + s.w/2; else s.w = minSize;
            if (s.h > minSize) s.y = my + s.h/2; else s.h = minSize;
            break;
        case "bottom-left":
            s.w = (oldX + oldW/2) - mx; s.h = my - (oldY - oldH/2);
            if (s.w > minSize) s.x = mx + s.w/2; else s.w = minSize;
            if (s.h > minSize) s.y = (oldY - oldH/2) + s.h/2; else s.h = minSize;
            break;
        case "bottom-right":
            s.w = mx - (oldX - oldW/2); s.h = my - (oldY - oldH/2);
            if (s.w > minSize) s.x = (oldX - oldW/2) + s.w/2; else s.w = minSize;
            if (s.h > minSize) s.y = (oldY - oldH/2) + s.h/2; else s.h = minSize;
            break;
    }
}

function ptInConvexPolygon(px, py, vertices) {
    if (!vertices || vertices.length < 3) return false;
    let crossProduct = (a, b, c) => (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
    // Determine winding
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
        if (s.type === 'rect') {
            envelopePoints.push({x: s.x - s.w/2 - shrinkwrapOffset, y: s.y - s.h/2 - shrinkwrapOffset});
            envelopePoints.push({x: s.x + s.w/2 + shrinkwrapOffset, y: s.y - s.h/2 - shrinkwrapOffset});
            envelopePoints.push({x: s.x - s.w/2 - shrinkwrapOffset, y: s.y + s.h/2 + shrinkwrapOffset});
            envelopePoints.push({x: s.x + s.w/2 + shrinkwrapOffset, y: s.y + s.h/2 + shrinkwrapOffset});
        }
        if (s.type === 'poly') {
            s.vertices.forEach(v => {
                envelopePoints.push({x: v.x - shrinkwrapOffset, y: v.y - shrinkwrapOffset});
                envelopePoints.push({x: v.x + shrinkwrapOffset, y: v.y + shrinkwrapOffset});
            });
        }
    });
    
    shrinkwrapShape.vertices = computeConvexHull(envelopePoints);
    draw();
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

function draw() {
    ctx.fillStyle = `rgb(${bgColor}, ${bgColor}, ${bgColor})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (bgImage) {
        ctx.globalAlpha = bgOpacity;
        const scale = Math.min(canvas.width / bgImage.width, canvas.height / bgImage.height);
        const imgW = bgImage.width * scale;
        const imgH = bgImage.height * scale;
        // Panning applies to image as well
        ctx.drawImage(bgImage, panOffsetX, panOffsetY, imgW, imgH);
        ctx.globalAlpha = 1.0;
    }
    
    ctx.save();
    ctx.translate(panOffsetX, panOffsetY);
    
    if (floorVisible) {
        ctx.fillStyle = "#FFFF00"; 
        ctx.globalAlpha = currentTool === "EXPORTING" ? 1.0 : 0.8;
        ctx.fillRect(-panOffsetX, (canvas.height - panOffsetY) * 0.9, canvas.width, canvas.height * 0.1);
        ctx.globalAlpha = 1.0;
    }
    
    if (shrinkwrapShape && shrinkwrapShape.vertices.length > 0) {
        ctx.fillStyle = shrinkwrapShape.fillColor;
        ctx.beginPath();
        ctx.moveTo(shrinkwrapShape.vertices[0].x, shrinkwrapShape.vertices[0].y);
        for (let i = 1; i < shrinkwrapShape.vertices.length; i++) ctx.lineTo(shrinkwrapShape.vertices[i].x, shrinkwrapShape.vertices[i].y);
        ctx.closePath();
        ctx.globalAlpha = currentTool === "EXPORTING" ? 1.0 : 0.4;
        ctx.fill();
        ctx.globalAlpha = 1.0;
        
        if (shrinkwrapShape === selectedShape && currentTool !== "EXPORTING") {
            ctx.strokeStyle = "rgba(255,255,255,0.8)";
            ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
        }
    }
    
    // Draw Shapes
    for (let s of shapes) {
        ctx.fillStyle = s.fillColor;
        ctx.globalAlpha = currentTool === "EXPORTING" ? 1.0 : 0.85;
        
        if (s.type === 'rect') {
            ctx.fillRect(s.x - s.w/2, s.y - s.h/2, s.w, s.h);
        } else if (s.type === 'poly' && s.vertices.length > 0) {
            ctx.beginPath();
            ctx.moveTo(s.vertices[0].x, s.vertices[0].y);
            for (let i=1; i<s.vertices.length; i++) ctx.lineTo(s.vertices[i].x, s.vertices[i].y);
            ctx.closePath();
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
        
        // Handles
        if (s === selectedShape && currentTool !== "EXPORTING") {
            ctx.fillStyle = "white"; ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1;
            const drawHndl = (hx, hy) => { ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
            
            if (s.type === 'rect') {
                drawHndl(s.x - s.w/2, s.y - s.h/2);
                drawHndl(s.x + s.w/2, s.y - s.h/2);
                drawHndl(s.x - s.w/2, s.y + s.h/2);
                drawHndl(s.x + s.w/2, s.y + s.h/2);
                ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.setLineDash([4, 4]);
                ctx.strokeRect(s.x - s.w/2, s.y - s.h/2, s.w, s.h); ctx.setLineDash([]);
            } else if (s.type === 'poly') {
                s.vertices.forEach(v => drawHndl(v.x, v.y));
                ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(s.vertices[0].x, s.vertices[0].y);
                for (let i=1; i<s.vertices.length; i++) ctx.lineTo(s.vertices[i].x, s.vertices[i].y);
                ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
            }
        }
    }
    
    // Draw active poly lines
    if (currentPolyVertices.length > 0 && currentTool !== "EXPORTING") {
        ctx.strokeStyle = '#2d5aff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(currentPolyVertices[0].x, currentPolyVertices[0].y);
        for(let i=1; i<currentPolyVertices.length; i++) ctx.lineTo(currentPolyVertices[i].x, currentPolyVertices[i].y);
        ctx.stroke();
    }
    
    ctx.restore();
}

function resizeCanvas() {
    const parent = document.getElementById('canvas-wrapper');
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    draw();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas(); 
