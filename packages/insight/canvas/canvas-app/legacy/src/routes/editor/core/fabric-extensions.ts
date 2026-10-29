import { Circle, FabricObject, Group, Polygon, Rect, Textbox, Triangle } from 'fabric';

const customProperties = ['id', 'name', 'shapeKind', 'fillColor', 'fillOpacity', 'strokeColor', 'strokeOpacity'];

// 全局配置自定义属性序列化
FabricObject.customProperties = customProperties;
Rect.customProperties = customProperties;
Circle.customProperties = customProperties;
Triangle.customProperties = customProperties;
Polygon.customProperties = customProperties;
Textbox.customProperties = customProperties;
Group.customProperties = customProperties;
