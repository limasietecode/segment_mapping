const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');

let shapes = [];
let shapeCountTarget = 3;
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

// Setup UI Listeners
document.getElementById('shapeCount').addEventListener('input', (e) => {
    document.getElementById('shapeCountVal').textContent = e.target.value;
    shapeCountTarget = parseInt(e.target.value);
    generateShapes();
});

document.getElementById('semanticColor').addEventListener('change', (e) => {
    currentClassColor = e.target.value;
    if (selectedShape) {
        selectedShape.fillColor = currentClassColor;
        if (shrinkwrapShape && shrinkwrapShape.isShrinkwrap && shrinkwrapShape === selectedShape) {
            shrinkwrapShape.fillColor = currentClassColor;
        }
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
    updateShrinkwrap();
});

const btnFloor = document.getElementById('btnFloor');
btnFloor.addEventListener('click', () => {
    floorVisible = !floorVisible;
    btnFloor.textContent = floorVisible ? "Remove Floor Plane" : "Add Floor Plane";
    btnFloor.classList.toggle('active');
    draw();
});

const btnShrinkwrap = document.getElementById('btnShrinkwrap');
btnShrinkwrap.addEventListener('click', () => {
    shrinkwrapActive = !shrinkwrapActive;
    if (shrinkwrapActive) {
        if (shapes.length < 3) {
            shrinkwrapActive = false;
            return;
        }
        shrinkwrapShape = { isShrinkwrap: true, fillColor: currentClassColor, vertices: [] };
        updateShrinkwrap();
        btnShrinkwrap.textContent = "Remove Shrinkwrap";
        btnShrinkwrap.classList.add('active');
    } else {
        shrinkwrapShape = null;
        btnShrinkwrap.textContent = "Compute Shrinkwrap";
        btnShrinkwrap.classList.remove('active');
        draw();
    }
});

document.getElementById('btnExportPNG').addEventListener('click', () => {
    // Hide UI handles temporarily for clean export
    const wasSelected = selectedShape;
    selectedShape = null;
    draw(); 
    
    // Create an anchor and download without UI
    const link = document.createElement('a');
    link.download = `mask_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    
    // Restore UI
    selectedShape = wasSelected;
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
        img.onload = () => {
            bgImage = img;
            btnRemoveImage.style.display = 'block';
            draw();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

document.getElementById('bgImageOpacity').addEventListener('input', (e) => {
    bgOpacity = parseFloat(e.target.value);
    document.getElementById('bgImageOpacityVal').textContent = Math.round(bgOpacity * 100) + "%";
    draw();
});

// JSON Save/Load
document.getElementById('btnSaveJSON').addEventListener('click', () => {
    const data = {
        shapes: shapes,
        shrinkwrapShape: shrinkwrapShape,
        bgColor: bgColor,
        floorVisible: floorVisible
    };
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
            
            document.getElementById('bgColor').value = bgColor;
            document.getElementById('shapeCount').value = shapes.length;
            document.getElementById('shapeCountVal').textContent = shapes.length;
            shapeCountTarget = shapes.length;
            
            if (floorVisible) {
                btnFloor.textContent = "Remove Floor Plane";
                btnFloor.classList.add('active');
            } else {
                btnFloor.textContent = "Add Floor Plane";
                btnFloor.classList.remove('active');
            }
            
            selectedShape = null;
            draw();
        } catch (err) {
            alert("Error parsing JSON file");
        }
    };
    reader.readAsText(file);
});

// Canvas Interaction
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let clickedOnShape = false;
    
    // Check backwards so top-most shapes are selected first
    for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        const corner = getResizeCorner(s, mx, my);
        
        if (corner) {
            selectedShape = s;
            resizing = true;
            resizeCorner = corner;
            clickedOnShape = true;
            break;
        } else if (contains(s, mx, my)) {
            selectedShape = s;
            isDragging = true;
            dragOffsetX = s.x - mx;
            dragOffsetY = s.y - my;
            clickedOnShape = true;
            // Bring to front
            shapes.splice(i, 1);
            shapes.push(s);
            break;
        }
    }
    
    // Also check shrinkwrap if not clicked on main shapes
    if (!clickedOnShape && shrinkwrapShape && ptInConvexPolygon(mx, my, shrinkwrapShape.vertices)) {
       selectedShape = shrinkwrapShape;
       clickedOnShape = true; // For color-picking purposes mainly
    }
    
    if (!clickedOnShape) {
        selectedShape = null;
    }
    
    // Update color picker UI to reflect selected shape
    const selColor = document.getElementById('semanticColor');
    if (selectedShape) {
        selColor.value = selectedShape.fillColor;
        currentClassColor = selectedShape.fillColor;
    }
    
    draw();
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (resizing && selectedShape && !selectedShape.isShrinkwrap) {
        resizeShape(selectedShape, mx, my, resizeCorner);
        if (shrinkwrapShape) updateShrinkwrap();
        draw();
    } else if (isDragging && selectedShape && !selectedShape.isShrinkwrap) {
        selectedShape.x = mx + dragOffsetX;
        selectedShape.y = my + dragOffsetY;
        if (shrinkwrapShape) updateShrinkwrap();
        draw();
    } else {
        // Change cursor based on hover
        let hoveringCorner = false;
        let hoveringShape = false;
        for (let i = shapes.length - 1; i >= 0; i--) {
            if (getResizeCorner(shapes[i], mx, my)) {
                hoveringCorner = true; break;
            } else if (contains(shapes[i], mx, my)) {
                hoveringShape = true; break;
            }
        }
        if (hoveringCorner) canvas.style.cursor = 'crosshair';
        else if (hoveringShape) canvas.style.cursor = 'move';
        else canvas.style.cursor = 'default';
    }
});

canvas.addEventListener('mouseup', () => {
    resizing = false;
    isDragging = false;
});

// Math & App Logic
function generateShapes() {
    while (shapes.length < shapeCountTarget) {
        shapes.push({
            x: canvas.width / 2 + (Math.random() - 0.5) * 150,
            y: canvas.height / 2 + (Math.random() - 0.5) * 150,
            w: 80 + Math.random() * 80,
            h: 80 + Math.random() * 80,
            fillColor: currentClassColor
        });
    }
    while (shapes.length > shapeCountTarget) {
        shapes.pop();
    }
    if (shrinkwrapShape) updateShrinkwrap();
    draw();
}

function contains(s, mx, my) {
    if (s.isShrinkwrap) return false; // Handled separately
    return mx > s.x - s.w/2 && mx < s.x + s.w/2 && my > s.y - s.h/2 && my < s.y + s.h/2;
}

function getResizeCorner(s, mx, my) {
    if (s.isShrinkwrap) return null;
    const tol = 12; // Handle hit tolerance
    const dist = (x1, y1, x2, y2) => Math.sqrt((x2-x1)**2 + (y2-y1)**2);
    
    if (dist(mx, my, s.x - s.w/2, s.y - s.h/2) < tol) return "top-left";
    if (dist(mx, my, s.x + s.w/2, s.y - s.h/2) < tol) return "top-right";
    if (dist(mx, my, s.x - s.w/2, s.y + s.h/2) < tol) return "bottom-left";
    if (dist(mx, my, s.x + s.w/2, s.y + s.h/2) < tol) return "bottom-right";
    return null;
}

function resizeShape(s, mx, my, corner) {
    let minSize = 20;
    let oldX = s.x, oldY = s.y, oldW = s.w, oldH = s.h;

    switch (corner) {
        case "top-left":
            s.w = (oldX + oldW/2) - mx;
            s.h = (oldY + oldH/2) - my;
            if (s.w > minSize) s.x = mx + s.w/2; else s.w = minSize;
            if (s.h > minSize) s.y = my + s.h/2; else s.h = minSize;
            break;
        case "top-right":
            s.w = mx - (oldX - oldW/2);
            s.h = (oldY + oldH/2) - my;
            if (s.w > minSize) s.x = (oldX - oldW/2) + s.w/2; else s.w = minSize;
            if (s.h > minSize) s.y = my + s.h/2; else s.h = minSize;
            break;
        case "bottom-left":
            s.w = (oldX + oldW/2) - mx;
            s.h = my - (oldY - oldH/2);
            if (s.w > minSize) s.x = mx + s.w/2; else s.w = minSize;
            if (s.h > minSize) s.y = (oldY - oldH/2) + s.h/2; else s.h = minSize;
            break;
        case "bottom-right":
            s.w = mx - (oldX - oldW/2);
            s.h = my - (oldY - oldH/2);
            if (s.w > minSize) s.x = (oldX - oldW/2) + s.w/2; else s.w = minSize;
            if (s.h > minSize) s.y = (oldY - oldH/2) + s.h/2; else s.h = minSize;
            break;
    }
}

function ptInConvexPolygon(px, py, vertices) {
    if (!vertices || vertices.length < 3) return false;
    let crossProduct = (a, b, c) => (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
    for (let i = 0; i < vertices.length; i++) {
        let nxt = (i+1)%vertices.length;
        if (crossProduct(vertices[i], vertices[nxt], {x: px, y: py}) < 0) return false;
    }
    return true;
}

function updateShrinkwrap() {
    if (!shrinkwrapShape || shapes.length < 3) return;
    
    let envelopePoints = [];
    shapes.forEach(s => {
        envelopePoints.push({x: s.x - s.w/2 - shrinkwrapOffset, y: s.y - s.h/2 - shrinkwrapOffset});
        envelopePoints.push({x: s.x + s.w/2 + shrinkwrapOffset, y: s.y - s.h/2 - shrinkwrapOffset});
        envelopePoints.push({x: s.x - s.w/2 - shrinkwrapOffset, y: s.y + s.h/2 + shrinkwrapOffset});
        envelopePoints.push({x: s.x + s.w/2 + shrinkwrapOffset, y: s.y + s.h/2 + shrinkwrapOffset});
    });
    
    shrinkwrapShape.vertices = computeConvexHull(envelopePoints);
    draw();
}

function computeConvexHull(points) {
    if (points.length < 3) return points;
    
    // Sort points lexicographically
    points.sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
    
    const crossProduct = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    
    let lower = [];
    for (let i = 0; i < points.length; i++) {
        while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], points[i]) <= 0) {
            lower.pop();
        }
        lower.push(points[i]);
    }
    
    let upper = [];
    for (let i = points.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], points[i]) <= 0) {
            upper.pop();
        }
        upper.push(points[i]);
    }
    
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

function draw() {
    // 1. Draw Background Color
    ctx.fillStyle = `rgb(${bgColor}, ${bgColor}, ${bgColor})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 2. Draw Reference Image Underlay
    if (bgImage) {
        ctx.globalAlpha = bgOpacity;
        const scale = Math.min(canvas.width / bgImage.width, canvas.height / bgImage.height);
        const x = (canvas.width / 2) - (bgImage.width / 2) * scale;
        const y = (canvas.height / 2) - (bgImage.height / 2) * scale;
        ctx.drawImage(bgImage, x, y, bgImage.width * scale, bgImage.height * scale);
        ctx.globalAlpha = 1.0;
    }
    
    // 3. Draw Floor
    if (floorVisible) {
        ctx.fillStyle = "#FF00FF"; // Magenta semantic for road/ground
        ctx.fillRect(0, canvas.height * 0.9, canvas.width, canvas.height * 0.1);
    }
    
    // 4. Draw Shrinkwrap
    if (shrinkwrapShape && shrinkwrapShape.vertices.length > 0) {
        ctx.fillStyle = shrinkwrapShape.fillColor;
        ctx.beginPath();
        ctx.moveTo(shrinkwrapShape.vertices[0].x, shrinkwrapShape.vertices[0].y);
        for (let i = 1; i < shrinkwrapShape.vertices.length; i++) {
            ctx.lineTo(shrinkwrapShape.vertices[i].x, shrinkwrapShape.vertices[i].y);
        }
        ctx.closePath();
        ctx.fill();
        
        if (shrinkwrapShape === selectedShape) {
            ctx.strokeStyle = "rgba(255,255,255,0.8)";
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
    
    // 5. Draw Shapes
    for (let s of shapes) {
        ctx.fillStyle = s.fillColor;
        ctx.fillRect(s.x - s.w/2, s.y - s.h/2, s.w, s.h);
        
        // Draw selection UI handles
        if (s === selectedShape) {
            ctx.fillStyle = "white";
            ctx.strokeStyle = "rgba(0,0,0,0.5)";
            ctx.lineWidth = 1;
            const drawHandle = (hx, hy) => {
                ctx.beginPath();
                ctx.arc(hx, hy, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            };
            drawHandle(s.x - s.w/2, s.y - s.h/2);
            drawHandle(s.x + s.w/2, s.y - s.h/2);
            drawHandle(s.x - s.w/2, s.y + s.h/2);
            drawHandle(s.x + s.w/2, s.y + s.h/2);
            
            // Draw border
            ctx.strokeStyle = "rgba(255,255,255,0.8)";
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(s.x - s.w/2, s.y - s.h/2, s.w, s.h);
            ctx.setLineDash([]);
        }
    }
}

// Keydown Events & Resize
window.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShape) {
        if (selectedShape.isShrinkwrap) {
            shrinkwrapShape = null;
            shrinkwrapActive = false;
            btnShrinkwrap.textContent = "Compute Shrinkwrap";
            btnShrinkwrap.classList.remove('active');
        } else {
            const idx = shapes.indexOf(selectedShape);
            if (idx > -1) {
                shapes.splice(idx, 1);
            }
            if (shrinkwrapShape) updateShrinkwrap();
        }
        selectedShape = null;
        draw();
    }
});

function resizeCanvas() {
    const parent = document.getElementById('canvas-wrapper');
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    draw();
}
window.addEventListener('resize', resizeCanvas);

// Initial Generation
resizeCanvas(); // will call draw
generateShapes();
