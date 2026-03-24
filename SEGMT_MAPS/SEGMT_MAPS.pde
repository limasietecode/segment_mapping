import controlP5.*;
import java.util.Arrays;

int shapeCount = 3;
ControlP5 cp5;
ArrayList<Shape> shapes = new ArrayList<>();
Shape selectedShape = null;
boolean resizing = false;
String resizeCorner = "";
Shape shrinkwrapShape = null;
boolean floorVisible = false;

void setup() {
  size(720, 1000);
  cp5 = new ControlP5(this);
  setupUI();
  generateShapes();
}

void draw() {
  background(cp5.getController("backgroundColor").getValue());
  if (floorVisible) {
    fill(0, 255, 0);
    noStroke();
    rect(0, height * 0.9, width, height * 0.1);
  }
  if (shrinkwrapShape != null) shrinkwrapShape.display();
  for (Shape s : shapes) s.display();
}

void setupUI() {
  cp5.addButton("floorButton")
    .setPosition(18, 225)
    .setSize(225, 25)
    .setLabel("ADD FLOOR")
    .plugTo(this, "toggleFloor");

  cp5.addSlider("shrinkwrapOffset")
    .setPosition(18, 155)
    .setSize(225, 13)
    .setRange(0, 50)
    .setValue(10)
    .setLabel("Shrinkwrap Offset")
    .plugTo(this, "updateShrinkwrap");

  cp5.addSlider("shapeCount")
    .setPosition(18, 18)
    .setSize(225, 13)
    .setRange(3, 20)
    .setValue(3)
    .setNumberOfTickMarks(18)
    .snapToTickMarks(true)
    .setLabel("Shape Count")
    .plugTo(this, "updateShapeCount");

  cp5.addSlider("colorSeed")
    .setPosition(18, 50)
    .setSize(225, 13)
    .setRange(0, 100)
    .setValue(0)
    .setLabel("Color Seed")
    .plugTo(this, "updateColorSeed");

  cp5.addSlider("backgroundColor")
    .setPosition(18, 190)
    .setSize(225, 13)
    .setRange(0, 255)
    .setValue(255)
    .setLabel("Background Color")
    .plugTo(this, "updateBackgroundColor");

  cp5.addButton("exportImage")
    .setPosition(18, 85)
    .setSize(225, 25)
    .setLabel("Export as PNG")
    .plugTo(this, "exportImage");

  cp5.addButton("shrinkwrap")
    .setPosition(18, 120)
    .setSize(225, 25)
    .setLabel("Shrinkwrap Me")
    .plugTo(this, "shrinkwrap");
}

void updateShapeCount(float value) {
  shapeCount = (int) value;
  generateShapes();
}

void updateColorSeed(float value) {
  randomSeed((int) value);
  for (Shape s : shapes) {
    s.fillColor = color(random(255), random(255), random(255));
  }
}

void updateBackgroundColor(float value) {
  // Background color is updated dynamically in draw()
}

void generateShapes() {
  while (shapes.size() < shapeCount) {
    shapes.add(new Shape(width / 2, height / 2, random(40, 100), random(40, 100), color(random(255), random(255), random(255))));
  }
  while (shapes.size() > shapeCount) shapes.remove(shapes.size() - 1);
}

void mousePressed() {
  boolean clickedOnShape = false;
  for (Shape s : shapes) {
    if (s.isInResizeCorner(mouseX, mouseY)) {
      selectedShape = s;
      resizing = true;
      resizeCorner = s.getResizeCorner(mouseX, mouseY);
      clickedOnShape = true;
      break;
    } else if (s.contains(mouseX, mouseY)) {
      selectedShape = s;
      resizing = false;
      clickedOnShape = true;
      break;
    }
  }
  if (!clickedOnShape) {
    selectedShape = null;
    resizing = false;
  }
}

void mouseDragged() {
  if (resizing && selectedShape != null) selectedShape.resize(mouseX, mouseY, resizeCorner);
  else if (selectedShape != null) selectedShape.setPosition(mouseX, mouseY);
  if (shrinkwrapShape != null) updateShrinkwrap();
}

void toggleFloor() {
  floorVisible = !floorVisible;
  cp5.getController("floorButton").setLabel(floorVisible ? "DELETE FLOOR" : "ADD FLOOR");
}

void mouseReleased() {
  resizing = false;
}

void exportImage() {
  saveFrame("output-####.png");
}

void shrinkwrap() {
  if (shapes.size() < 3) return;

  shrinkwrapShape = new Shape(0, 0, 0, 0, color(random(255), random(255), random(255)));
  shrinkwrapShape.isShrinkwrap = true;
  updateShrinkwrap();
}

void updateShrinkwrap() {
  if (shrinkwrapShape == null || shapes.size() < 3) return;

  float offset = cp5.getController("shrinkwrapOffset").getValue();
  ArrayList<PVector> envelopePoints = new ArrayList<>();

  for (Shape s : shapes) {
    if (!s.isShrinkwrap) {
      envelopePoints.add(new PVector(s.x - s.w / 2 - offset, s.y - s.h / 2 - offset)); // Top-left
      envelopePoints.add(new PVector(s.x + s.w / 2 + offset, s.y - s.h / 2 - offset)); // Top-right
      envelopePoints.add(new PVector(s.x - s.w / 2 - offset, s.y + s.h / 2 + offset)); // Bottom-left
      envelopePoints.add(new PVector(s.x + s.w / 2 + offset, s.y + s.h / 2 + offset)); // Bottom-right
    }
  }

  ArrayList<PVector> hull = computeConvexHull(envelopePoints);

  shrinkwrapShape.vertices = hull;
}

ArrayList<PVector> computeConvexHull(ArrayList<PVector> points) {
  if (points.size() < 3) return points;

  PVector centroid = new PVector(0, 0);
  for (PVector p : points) {
    centroid.add(p);
  }
  centroid.div(points.size());

  points.sort((a, b) -> Float.compare(
    atan2(a.y - centroid.y, a.x - centroid.x),
    atan2(b.y - centroid.y, b.x - centroid.x)
  ));

  ArrayList<PVector> hull = new ArrayList<>();
  for (PVector p : points) {
    while (hull.size() >= 2) {
      PVector q = hull.get(hull.size() - 1);
      PVector r = hull.get(hull.size() - 2);
      if ((q.x - r.x) * (p.y - r.y) - (q.y - r.y) * (p.x - r.x) > 0) break;
      hull.remove(hull.size() - 1);
    }
    hull.add(p);
  }
  return hull;
}

class Shape {
  float x, y, w, h;
  color fillColor;
  boolean isShrinkwrap = false;
  ArrayList<PVector> vertices;

  Shape(float x, float y, float w, float h, color fillColor) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.fillColor = fillColor;
  }

  void display() {
    if (isShrinkwrap && vertices != null) {
      fill(fillColor);
      noStroke();
      beginShape();
      for (PVector v : vertices) vertex(v.x, v.y);
      endShape(CLOSE);
    } else {
      fill(fillColor);
      noStroke();
      rect(x - w / 2, y - h / 2, w, h);
      if (this == selectedShape) {
        fill(255, 0, 0);
        ellipse(x - w / 2 - 10, y - h / 2 - 10, 5, 5); // Top-left
        ellipse(x + w / 2 + 10, y - h / 2 - 10, 5, 5); // Top-right
        ellipse(x - w / 2 - 10, y + h / 2 + 10, 5, 5); // Bottom-left
        ellipse(x + w / 2 + 10, y + h / 2 + 10, 5, 5); // Bottom-right
              }
    }
  }

  boolean contains(float mx, float my) {
    return mx > x - w / 2 && mx < x + w / 2 && my > y - h / 2 && my < y + h / 2;
  }

  boolean isInResizeCorner(float mx, float my) {
    return getResizeCorner(mx, my) != null;
  }

  String getResizeCorner(float mx, float my) {
    if (dist(mx, my, x - w / 2 - 10, y - h / 2 - 10) < 10) return "top-left";
    if (dist(mx, my, x + w / 2 + 10, y - h / 2 - 10) < 10) return "top-right";
    if (dist(mx, my, x - w / 2 - 10, y + h / 2 + 10) < 10) return "bottom-left";
    if (dist(mx, my, x + w / 2 + 10, y + h / 2 + 10) < 10) return "bottom-right";
    return null;
  }

  void resize(float mx, float my, String corner) {
    switch (corner) {
      case "top-left":
        w += x - w / 2 - mx;
        h += y - h / 2 - my;
        x = mx + w / 2;
        y = my + h / 2;
        break;
      case "top-right":
        w = mx - (x - w / 2);
        h += y - h / 2 - my;
        y = my + h / 2;
        break;
      case "bottom-left":
        w += x - w / 2 - mx;
        h = my - (y - h / 2);
        x = mx + w / 2;
        break;
      case "bottom-right":
        w = mx - (x - w / 2);
        h = my - (y - h / 2);
        break;
    }
  }

  void setPosition(float nx, float ny) {
    x = nx;
    y = ny;
  }
}
