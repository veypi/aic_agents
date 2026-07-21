# OCCT WASM 内核 API 参考 (v1.1.1)

## 加载

```js
import { createOCCTKernel } from './occt-kernel.js';
const kernel = await createOCCTKernel();
viewer.options.kernel = kernel;
```

## 图元

### box(w, d, h)
```js
box(50, 30, 20)  // w, d, h
// → OCCTShape { positions, indices, volume(), area(), ... }
// OCCT: BRepPrimAPI_MakeBox_1(w, d, h).Shape()
```

### cylinder(r, h, segments)
```js
cylinder(10, 40, 48)  // 半径, 高度, 圆周分段
// OCCT: BRepPrimAPI_MakeCylinder_2(r, h, 2π).Shape()
// 自动居中 (Z 轴 -h/2 ~ +h/2)
```

### cone(rBottom, rTop, h, segments)
```js
cone(10, 3, 30, 48)  // 底半径, 顶半径(0=圆锥), 高, 分段
// OCCT: BRepPrimAPI_MakeCone_2(rB, rT, h, 2π).Shape()
```

### sphere(r, segments, rings)
```js
sphere(15, 48, 24)  // 半径, 经度分段, 纬度分段
// OCCT: BRepPrimAPI_MakeSphere_4(r, 2π).Shape()
```

### torus(R, r, segments, tubeSeg)
```js
torus(20, 5, 48, 24)  // 主半径, 截面半径, 主分段, 截面分段
// OCCT: BRepPrimAPI_MakeTorus_4(R, r, 2π).Shape()
```

### pipe(rOuter, rInner, h, segments)
```js
pipe(10, 8, 30, 48)  // 外径, 内径, 高, 分段
// OCCT: cylinder(rOuter).cut(cylinder(rInner))
```

## 草图

### sketchRect(w, h)
```js
sketchRect(30, 20).extrude(10)
```

### sketchCircle(r, segments)
```js
sketchCircle(15, 48).extrude(8)
```

### sketchRoundedRect(w, h, r, cornerSeg)
```js
sketchRoundedRect(40, 20, 5, 8).extrude(10).fillet(2)
```

### sketchPolygon(points)
```js
sketchPolygon([[0,0],[20,0],[10,15]]).extrude(10)
```

## 旋转成型

### revolve(profile, segments)
```js
// profile: [[半径, z], ...]  (Z=轴向)
revolve([[20,-30],[35,-10],[15,10],[25,30]], 64)
```

### lathe(profile, segments)
```js
// revole 别名
lathe(profile, 64)
```

## 变换 (链式调用)

```js
box(10, 10, 10)
  .translate(5, 0, 10)
  .rotateX(45)
  .rotateZ(90)
  .scale(2)          // 均匀缩放
  .scale(2, 1, 1.5)  // 非均匀缩放
```

## 布尔运算

```js
shape.fuse(other)       // 并集
shape.cut(other)        // 差集
shape.intersect(other)  // 交集
```

## 圆角

```js
box(30, 30, 30).fillet(5)
// 对所有边倒圆角；失败时保留原几何体 + 警告
```

## 齿轮

```js
const pts = gearProfile(20, 2);  // 齿数, 模数
sketchPolygon(pts).extrude(10);
```

## 属性

```js
shape.volume()        // mm³
shape.area()          // mm² (表面积)
shape.bounds()        // { min: [x,y,z], max: [x,y,z] }
shape.vertexCount   // getter
shape.triangleCount // getter
shape.edgeCount()     // 边数
shape.positions       // getter, Float32Array
shape.indices         // getter, Uint32Array
```

## OCCT v1.1.1 API 规律

### 枚举

```js
oc.TopAbs_ShapeEnum.TopAbs_FACE   // = {value: 4}
oc.TopAbs_ShapeEnum.TopAbs_EDGE   // = {value: 6}
oc.TopAbs_ShapeEnum.TopAbs_SHAPE  // = {value: 8}
```

### 关键 API 映射

| 用途 | OCCT 调用 |
|------|----------|
| 三角化 | `new oc.BRepMesh_IncrementalMesh_2(shape, 1.0, 0, 0.5, 0)` |
| 遍历面 | `new oc.TopExp_Explorer_2(shape, FACE, SHAPE)` |
| 获取三角剖分 | `oc.BRep_Tool.Triangulation(face, loc).get()` |
| 三角面顶点 | `tri.Value(1)`, `tri.Value(2)`, `tri.Value(3)` (1-based) |
| 体积 | `oc.BRepGProp.VolumeProperties_1(shape, props, 1e-4, 0, 0)` |
| 表面积 | `oc.BRepGProp.SurfaceProperties_1(shape, props, 1e-4, 0)` |
| 包围盒 | `oc.BRepBndLib.Add_3(shape, bbox, 1)` |
| 变换 | `new oc.BRepBuilderAPI_Transform_2(shape, trsf, 1)` |
| 平移 | `trsf.SetTranslation_1(new oc.gp_Vec_4(x, y, z))` |
| 旋转 | `trsf.SetRotation_1(axis, rad)` |
| 缩放 | `trsf.SetScale_1(new oc.gp_Pnt_3(0,0,0), scale)` |

### bool 参数

OCCT v1.1.1 不接受 JavaScript `false`/`true`，必须用 `0`/`1`。

### Handle 对象

`Triangulation()` 返回 `Handle_Poly_Triangulation`，必须 `.get()` 获取底层对象。

### 方法后缀规则

| 方法 | 后缀示例 |
|------|----------|
| add point | `pg.Add_1(pt)` |
| set transform | `trsf.SetTranslation_1(vec)` |
| set rotation | `trsf.SetRotation_1(ax, rad)` |
| set scale | `trsf.SetScale_1(pt, s)` |
| get mass | `props.Mass()` (无后缀) |
| get shape | `algo.Shape()` (无后缀) |
| check done | `algo.IsDone()` (无后缀) |
| build | `mkFillet.Build()` (无后缀) |

### 点/向量构造

```js
new oc.gp_Pnt_3(x, y, z)      // 3D 点
new oc.gp_Dir_4(x, y, z)      // 方向向量
new oc.gp_Vec_4(x, y, z)      // 位移向量
new oc.gp_Ax1_2(origin, dir)  // 轴
new oc.gp_Trsf_1()            // 变换矩阵
```
