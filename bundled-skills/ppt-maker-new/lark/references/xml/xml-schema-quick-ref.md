# XML Schema 快速参考

本文是本地 PPTX 后端的 SML 写法参考。语法以 [XSD](slides_xml_schema_definition.xml) 为准，可保真导出的子集以 `lark/scripts/backend_capabilities.py` 和实际转换检查为准；本文不能覆盖二者。`lark` 命名空间沿用格式标识，不表示需要飞书上传或鉴权。

SOL 的生成提示已包含可执行契约；需要具体元素写法时按下列章节查询。示例字体须替换为 `font_preflight.json` 确认可用的常见系统字体。全文结构如下：

- **最小示例**：先看这节建立整体认知。
- **presentation 根元素**、**theme 与文本类型**、**slide 元素**、**content 内容模型**（含 `p 段落与内联标签`）：文档骨架与文本模型。
- **data 常用元素**：`shape`、`line`、`polyline`、`img`、`icon`、`table`、`chart` 七类可视元素的写法。
- **颜色与样式**：`fill`、`border`、`颜色格式`、`页面背景`。
- **note 示例**、**完整示例**、**详细参考**。

每个元素小节统一按 **描述 → 属性 → 子元素 → 注意事项 → 示例** 的顺序组织。

## 最小示例

```xml
<presentation xmlns="https://www.larkoffice.com/sml/2.0" width="960" height="540">
  <slide>
    <data>
      <shape type="text" topLeftX="80" topLeftY="80" width="800" height="120">
        <content textType="title" fontSize="36">
          <p>文字</p>
        </content>
      </shape>
    </data>
  </slide>
</presentation>
```

文本和属性值里的 `&`、`<`、`>` 必须转义为 `&amp;` / `&lt;` / `&gt;`。

## presentation 根元素

**属性**

| 属性 | 必需 | 说明 |
|------|------|------|
| `width` | 是 | 演示文稿宽度，必须固定设置为 960 |
| `height` | 是 | 演示文稿高度，必须固定设置为 540 |
| `id` | 否 | 演示文稿标识 |

**子元素**

- `<title>?`
- `<theme>?`
- `<slide>+`

**注意事项**

- 协议标准写法应使用 `<presentation xmlns="https://www.larkoffice.com/sml/2.0">`，始终带上命名空间。
- 所有坐标和尺寸单位是 px，主体元素必须落在画布内。
- 托管生成逐页保存 `<slide>`，批次大小由输出容量决定；没有本地 100 页总页数上限。`presentation` 用于聚合或离线格式示例，不是远端创建命令。

## theme 与文本类型

**属性**

`<textStyles>` 下各文本类型元素（`<title>`、`<body>` 等）的常用属性：

| 属性 | 说明 |
|------|------|
| `fontFamily` | 字体 |
| `fontSize` | 字号 |
| `fontColor` | 字体颜色 |

`textStyles` 的 schema 默认值如下：

| textType | 默认字号 |
|----------|----------|
| `title` | 54 |
| `headline` | 38 |
| `sub-headline` | 32 |
| `body` | 16 |
| `caption` | 12 |

**子元素**

`<theme>` 当前包含两部分：

- `<background>`：演示文稿级背景填充
- `<textStyles>`：主题文本样式集合

`<textStyles>` 下可选子元素包括：

- `<title>`
- `<headline>`
- `<sub-headline>`
- `<body>`
- `<caption>`

这些元素定义的是主题默认样式，不是页面结构。

**注意事项**

- XSD 中的 `title`、`headline`、`sub-headline`、`body`、`caption` 主要出现在：
  - `<theme><textStyles>...</textStyles></theme>` 中，作为主题文本样式
  - `<content textType="...">` 中，作为内容的文本类型
- 默认字号是省略 `fontSize` 时的兜底字号，不是推荐值，且明显偏大；字号必须在 `<content>` 上显式设置，详见「content 内容模型」。

## slide 元素

**属性**

| 属性 | 必需 | 说明 |
|------|------|------|
| `id` | 否 | 幻灯片标识 |

**子元素**

- `<style>?` - 页面样式，目前可放 `<fill>`
- `<data>?` - 页面元素容器，可放 `shape`、`line`、`polyline`、`img`、`icon`、`table`、`chart`；不要生成本地不支持的 `undefined`、`embed`、`whiteboard`。
- `<note>?` - 演讲者备注，内部可放 `<content>`

**注意事项**

- 这意味着 `<title>`、`<headline>`、`<sub-headline>`、`<body>`、`<caption>` 不能直接放在 `<slide>` 下；页面文本一律用 `<shape type="text">` + `<content>` 表达。

## content 内容模型

`<content>` 可出现在 `shape`、`table/td`、`note` 中。

**属性**

常用属性包括：

| 属性 | 说明 |
|------|------|
| `textType` | `title` / `headline` / `sub-headline` / `body` / `caption` |
| `verticalAlign` | 垂直对齐：`top` / `middle` / `bottom`（默认 `middle`） |
| `textAlign` | 文本对齐：`left` / `center` / `right` / `justify` / `dist`（`shape type="text"` 默认 `left`，其它形状默认 `center`） |
| `lineSpacing` | 行间距，显式写 `multiple:1.2` 或 `fixed:24` 等；省略则继承后端样式 |
| `letterSpacing` | 字间距，单位 px，作用于 `content`/`p` 层级，默认 `0`（正值拉开、负值收紧） |
| `fontSize` | 字号 |
| `fontFamily` | 已安装的常见系统字体，如 Microsoft YaHei、PingFang SC、Arial；使用预检返回的真实 family，不写逗号回退串 |
| `color` | 字体颜色（注意用 `color`，不是 `fontColor`；`fontColor` 只用于 `<theme><textStyles>`） |
| `bold` / `italic` / `underline` / `strikethrough` | 内容级样式 |
| `wrap` | 是否自动换行，默认 `true`，会按文本框宽度自动折行 |
| `autoFit` | 自动缩排：`normal-auto-fit` / `no-auto-fit` / `shape-auto-fit`（默认 `no-auto-fit`） |

**子元素**

`<content>` 直接子元素只有：

- `<p>`
- `<ul>`
- `<ol>`

**注意事项**

- 字号必须显式设置 `<content>` 的 `fontSize` 属性，不要依赖 `textType` 的默认字号兜底，这些兜底值明显偏大。本文档示例中的 `fontSize` 仅用于演示"必须显式声明"，不是推荐值，实际字号以选定设计系统为准。
- 文字颜色必须用 `<content>` 的 `color` 属性而不是 `fontColor` 属性（`fontColor` 仅用于 `<theme><textStyles>` 主题样式）。
- 文字行间距必须设置 `<content>` 的 `lineSpacing="multiple:xx"` 或 `lineSpacing="fixed:xx"` 而不是 `lineSpacing="xx"`。
- 字间距 `letterSpacing` 单位是 px：实用区间约 **`-0.5 ~ 2`**：标题想拉开质感设 `1~2`，正文一般 `0` 或轻微负值（如 `-0.5`）收紧即可；数值过大会把文字撑出容器、过小会导致字符重叠。
- 仅有意单行且已留足宽度的标题、指标、短标签使用 `wrap="false"`。标题也可明确设 `wrap="true"` 并提供足够行高；层级不是行数限制。先预留实际文字空间，再放装饰，不设计只有 1–2px 可行余量的布局。

### p 段落与内联标签

`<p>` 是段落元素，可混排纯文本和内联标签。

**子元素**

可混排的内联标签：

- `<br/>`
- `<strong>`
- `<em>`
- `<u>`
- `<span>`
- `<del>`

**注意事项**

- **局部样式写在 `<span>` 上**：`strong`、`em`、`u`、`del` 不接受样式属性。支持 `color`、`fontSize`、`fontFamily`、`bold`、`italic`、`underline`、`strikethrough`；例如 `<span bold="true" color="rgba(37,99,235,1)">重点</span>`。
- XSD 接受不代表本地保真：内联 `shadow`/`outline`、span 的背景色及链接的可点击行为不保留。不要用它们承载信息。
- 本地后端不排版 LaTeX；`formula` 只导出原始文本并报告 `formula_as_text`。复杂公式应使用已准备好的本地公式图；简单公式可由 SOL 在不改变含义的前提下写为普通文本。不要为通过校验丢失上下标或数学语义。

**示例**

```xml
<content textType="body" textAlign="left" fontSize="16">
  <p>正文内容 <strong>加粗</strong> <em>斜体</em></p>
  <ul>
    <li><p>列表项 1</p></li>
    <li><p>列表项 2</p></li>
  </ul>
</content>
```

## data 常用元素

所有页面元素都放在 `<data>` 中。

**注意事项**

- 同一 `<data>` 内元素按文档先后顺序绘制，**后写的在上层**（想让文字压在形状上，就把文字写在形状之后）。

### shape

`shape` 可表示普通形状，也可表示文本框。文本框推荐使用 `type="text"`。

**属性**

| 属性 | 必需 | 说明 |
|------|------|------|
| `type` | 是 | 常用 `text` / `rect` / `round-rect` / `slides-full-round-rect` / `ellipse` / `triangle` / `diamond`；其他类型使用生成契约中的本地支持值，不能只看 XSD |
| `topLeftX` | 是 | 左上角 X 坐标 |
| `topLeftY` | 是 | 左上角 Y 坐标 |
| `width` | 是 | 宽度 |
| `height` | 是 | 高度 |
| `presetHandlers` | 否 | 圆角半径（px） |
| `rotation` | 否 | 旋转角度（度），取值 `[0, 360)`，默认 `0`，不支持负数 |
| `alpha` | 否 | 透明度 |

**子元素**

可选子元素：

- `<fill>`
- `<border>`
- `<content>`

**注意事项**

- `<shape type="rect">` 只是形状不是容器，`<icon>`、`<img>`、`<shape type="text">` 和其他 `<shape>` 必须与它平级靠坐标叠放。
- **圆角**用 `presetHandlers` 设置，值是圆角半径，**单位 px，不是比例**。
- 半径超过 `min(width, height) / 2` 会自动夹紧到该值，所以胶囊形设成 `height/2` 即可，也可以直接用 `type="slides-full-round-rect"`（全圆角，不需要 `presetHandlers`）。
- 圆角必须使用 `round-rect` 或 `slides-full-round-rect`；`rect` 不因 `presetHandlers` 变成圆角。`flipX`/`flipY`、阴影和倒影不由本地后端保留，不要依赖这些效果。
- `<border>` 的 `width` 为非负整数，不支持小数；没有 `<border>` 时本地转换器显式关闭描边。
- 估算文本框宽度时需要注意大部分字体里的中文、英文、数字不等宽。

**示例**

文本框：

```xml
<shape type="text" topLeftX="80" topLeftY="80" width="800" height="120">
  <content textType="title" fontSize="36">
    <p>主标题</p>
  </content>
</shape>
```

矩形：

```xml
<shape type="rect" topLeftX="120" topLeftY="120" width="240" height="120">
  <fill>
    <fillColor color="rgb(100, 149, 237)"/>
  </fill>
  <border color="rgb(0, 0, 0)" width="2"/>
</shape>
```

圆角矩形：

```xml
<shape type="round-rect" topLeftX="120" topLeftY="120" width="240" height="120" presetHandlers="12">
  <fill>
    <fillColor color="rgba(37,99,235,1)"/>
  </fill>
</shape>
```

### line

**属性**

- `line` 使用的是 `startX` / `startY` / `endX` / `endY`，不是 `x1` / `y1` / `x2` / `y2`。

**子元素**

- `<border>` 是必需子元素。
- `<startArrow>` / `<endArrow>` 可选，`type` 取 `none` / `arrow` / `empty-triangle` / `solid-triangle` / `empty-diamond` / `solid-diamond` / `empty-circle` / `solid-circle`，**默认 `none`，必须显式写 `type` 才有箭头**（空标签 `<endArrow/>` 画不出箭头）；`widthScale` / `heightScale` 可选，只有 `sm` / `med` / `lg` 三档，`type="none"` 时无效。

**示例**

```xml
<line startX="120" startY="120" endX="420" endY="120">
  <border color="rgb(43, 47, 54)" width="2"/>
</line>
```

### polyline

折线 / 曲线连接符。

**属性**

- 用外接矩形定位（`topLeftX` / `topLeftY` / `width` / `height`），连接矩形左上角和右下角。
- 本地原生支持 `bent-connector2` 与 `curved-connector2`，不支持 3–5 段变体；`flipX`/`flipY` 和拐点 `presetHandlers` 不保留。需其他路径时，由 SOL 用显式端点的 `line` 组合表达。

**子元素**

- `<border>` 是必需子元素。
- `<startArrow>` / `<endArrow>` 可选，参考 `line`。

**注意事项**

- 直线用 `line`（两端点坐标），需要绕行或带弧度的连接用 `polyline`（外接矩形）。

**示例**

```xml
<polyline type="bent-connector2" topLeftX="120" topLeftY="120" width="200" height="120">
  <border color="rgb(43, 47, 54)" width="2"/>
  <endArrow type="arrow"/>
</polyline>
```

### img

**属性**

- `src` 是项目 `assets/` 内的相对路径：`<project>/assets/photo.jpg` 对应 `src="photo.jpg"`，不要重复加 `assets/`。转换器直接嵌入本地文件，不上传、不鉴权、不用 file_token，不接受 http(s) 或越界路径。素材需先通过本地 consumer/所有权检查。
- **`width`/`height` 是裁剪后的显示尺寸**。比例和原图不一致时按等比铺满裁剪；未指定 `anchor` 时居中，指定后保留对应侧。想不裁原图边缘，让图片宽高比对齐原图并使用 `rect`；圆角/椭圆轮廓仍会遮去角部。
- `rotation` 可选，旋转角度（度），取值 `[0, 360)`，默认 `0`，不支持负数。

**子元素**

- **裁剪形状**用可选子元素 `<crop>` 控制，本地支持 `rect`、`round-rect`、`ellipse`，默认 `rect`。圆角和椭圆导出为原生形状图片填充，保留原图，不生成蒙版 PNG。
- **裁剪保留哪一侧**用 `<crop>` 的 `anchor` 控制，取 `top` / `bottom` / `left` / `right`，分别表示保留顶部、底部、左侧、右侧，裁掉对侧多余的部分；**不写就是默认居中裁剪**（没有 `anchor="center"`，想要保持居中裁剪就不要写 `anchor`）。
- 图片自身的 `<border color="rgb(...)" width="1"/>` 沿裁切轮廓描边；省略即无边框。不要另垫圆角底板模拟图片裁切。

**注意事项**

- 图片元素是 `<img>`，不是 `<image>`；`img` 使用 `topLeftX` / `topLeftY`，不是 `x` / `y`。
- 复用素材和生成图都必须先取得本项目的就绪证据；同名文件存在不等于可用。
- **圆形头像必须 `width == height`**：`<crop type="ellipse">` 是在 `width`×`height` 外接矩形里画椭圆，宽高不等得到的是椭圆不是正圆。
- `crop/presetHandlers` 是非负有限的圆角半径（px），上限自动夹紧到图片短边的一半；`round-rect` 省略半径时取短边的 1/6。兼容旧写法 `type="rect" presetHandlers="16"`。
- `roundedCorners="all|top|bottom|left|right"` 选择全部或一侧两个圆角，默认 all。贴边图只圆卡片外缘角，图文接缝直角；与外卡片使用相同半径并为图片区域留足尺寸。局部圆角为原生自由形状图片填充，非截图；全圆角为预设圆角矩形。文字、底板仍是独立可编辑对象，组合不产生裁切。
- `ellipse` 不接受圆角参数；本地不接受自定义 crop/path 或四向 offset，使用支持的形状和 anchor。不支持的裁切报告错误，不静默变成矩形。
- 人像按实际构图选锚点，例如 `<crop anchor="top"/>` 保留顶部。锚点不是主体识别，圆角/圆形轮廓也可能裁到主体；SOL 应选择适配构图与图框，不把 `top` 当成“保证不裁头部”。

**示例**

```xml
<img src="photo.jpg" topLeftX="80" topLeftY="120" width="320" height="180"/>
```

```xml
<!-- 圆形头像：ellipse + width == height -->
<img src="portrait.jpg" topLeftX="80" topLeftY="120" width="160" height="160">
  <crop type="ellipse" anchor="top"/>
</img>
<!-- 顶部锚定示例；仍需按原图实际主体位置选择 -->
<img src="portrait.jpg" topLeftX="560" topLeftY="120" width="240" height="160">
  <crop anchor="top"/>
</img>
```

**上图下文贴边卡片**（正文区域由 SOL 留在图片下方；无需额外生成图片）：

```xml
<shape type="round-rect" topLeftX="60" topLeftY="120" width="320" height="320" presetHandlers="20">
  <fill><fillColor color="rgb(245,245,245)"/></fill>
</shape>
<img src="photo.jpg" topLeftX="60" topLeftY="120" width="320" height="180">
  <crop type="round-rect" presetHandlers="20" roundedCorners="top"/>
</img>
<shape type="text" topLeftX="80" topLeftY="320" width="280" height="90">
  <content textType="body" fontSize="18"><p>卡片正文</p></content>
</shape>
```

留白内嵌型：图片与卡片外缘分离，图片可以直角或独立小圆角。
整图背景型：使用完整圆角图框，文字与必要遮罩单独排布并留在轮廓内；不由转换器推断遮罩或裁切主体。

### icon

**注意事项**

- 图标必须填充**不透明** `fillColor`（`<fill><fillColor color="rgba(R,G,B,1)"/></fill>`，alpha 取 1）并和背景有足够对比。
- 不猜 iconType；由 SOL 从渲染提示的 `offline_icon_types` 或 `iconpark_tool.py` 默认离线检索结果选择，见 [iconpark.md](iconpark.md)。语义图标使用可用的 IconPark 或已准备好的本地图像，不依赖 emoji 的跨平台字体表现；无合适图标时由 SOL 调整构图，不随机替换。

**示例**

```xml
<icon iconType="iconpark/Charts/chart-line.svg" topLeftX="80" topLeftY="120" width="32" height="32">
  <fill>
    <fillColor color="rgba(37, 99, 235, 1)"/>
  </fill>
</icon>
```

### table

简单表格可优先用 `rect`+`text` 靠坐标模拟以获得更强的版式控制；需要标准表格结构时才用 `<table>`。

**子元素**

表格结构为：

- `<table>` 直接子元素只有 `<colgroup>` 和 `<tr>`，`width` 和 `height` 分别表示表格的目标总宽度和总高度。
- `<colgroup>` 直接子元素只有 `<col width="...">`，width 定义列宽，默认 110。
- `<tr height="...">` 直接子元素只有 `<td>`，height 定义行高，默认 37。
- `<td>` 直接子元素只有 `<fill>`（背景）、`<content>`（文字）和边框配置（一般不用），不能嵌套 `<shape>`、`<img>`、`<icon>`。

**注意事项**

- 表头默认的白底白字视觉效果极差，必须设置背景和文字颜色，需在首行每个 `<td>` 上加 `<fill>`（配合 `bold` 与对比文字色）与正文行区分。
- 表格里的文字默认是居中对齐，可以设置 `textAlign` 调整对齐方式。
- 表格宽高设置：
  - 已设置的列宽和行高优先保留，未设置的列宽、行高会使用表格的目标总宽度、总高度分配剩余空间
  - **`<table>` 必须设置 `width` 和 `height` 固定整体表格大小，行高列宽建议默认分配，只设置少数必要的 `<col>` 的 `width` 和 `<tr>` 的 `height`。**
- 确实需要显式写 `<tr height="...">` 时，不同字号的行高参考：

| `fontSize` | 内容行数 | 紧凑 `height` | 适中 `height` | 宽松 `height` |
|------|------|------|------|------|
| 15 | 单行 | 28 | 36 | 44 |
| 18 | 单行 | 32 | 40 | 48 |
| 15 | 双行 | 48 | 56 | 64 |
| 18 | 双行 | 56 | 64 | 72 |

**示例**

```xml
<table topLeftX="80" topLeftY="140" width="760" height="110">
  <colgroup>
    <col width="200"/>
    <col width="140"/>
    <col />
  </colgroup>
  <tr height="48">
    <td>
      <fill><fillColor color="rgba(30,60,114,1)"/></fill>
      <content textType="body" fontSize="16" fontFamily="Microsoft YaHei" bold="true" color="rgba(255,255,255,1)" textAlign="center"><p>项目</p></content>
    </td>
    <td>
      <fill><fillColor color="rgba(30,60,114,1)"/></fill>
      <content textType="body" fontSize="16" fontFamily="Microsoft YaHei" bold="true" color="rgba(255,255,255,1)" textAlign="right"><p>营收</p></content>
    </td>
    <td>
      <fill><fillColor color="rgba(30,60,114,1)"/></fill>
      <content textType="body" fontSize="16" fontFamily="Microsoft YaHei" bold="true" color="rgba(255,255,255,1)" textAlign="left"><p>备注说明</p></content>
    </td>
  </tr>
  <tr>
    <td><content textType="body" fontSize="16" fontFamily="Microsoft YaHei" textAlign="center"><p>线上业务</p></content></td>
    <td><content textType="body" fontSize="16" fontFamily="Microsoft YaHei" textAlign="right"><p>195</p></content></td>
    <td><content textType="body" fontSize="16" fontFamily="Microsoft YaHei" textAlign="left"><p>同比增长 8%，主要来自新客</p></content></td>
  </tr>
</table>
```

### chart

图表结构参考 [slides_chart_demo.xml](slides_chart_demo.xml) 中的柱状、条形、折线、面积、饼（环）、雷达示例。组合图 `combo` 不在本地保真子集中，不能直接照抄；原生类型以生成契约为准。

**子元素**

- 必需：`<chartPlotArea>`（绘图区）和 `<chartData>`（数据）。
- 可选：`<chartTitle>`、`<chartSubTitle>`、`<chartStyle>`、`<chartLegend>`、`<chartTooltip>`，如果想不展示标题、副标题、图例或悬浮提示，省略相应元素标签即可。

**注意事项**

- 漏斗、金字塔、象限、矩阵、关系网络图等非原生图表改用 `<shape>`+`<line>` 组合模拟。关系网络图用小圆点（`<shape type="ellipse">`）作节点、旁边配 `<shape type="text">` 标注文字（不要放到节点里），节点之间用 `<line>` 连线。
- 环形图不是独立类型：它就是 `<chartPlot type="pie">` 再给 `<chartSectors>` 设 `innerRadius`（如 `innerRadius="0.55"`）挖空中心得到的——**没有 `type="doughnut"` 或 `donut` 这种类型**，参考范例中标注 `pie with innerRadius (doughnut)` 的片段。范例仅用于语法和数据结构，不是可直接复用的业务数据或整页设计。
- 隐藏 `<chart>` 的图例只能通过不写或删除 `<chartLegend>` 实现，`<chartLegend>` 不支持 `position="none"`（`position` 只有 `top` / `bottom` / `left` / `right`）。
- `<chartLabel>`（单数，放 `<chartAxis>` 内）是坐标轴刻度标签；`<chartLabels>`（复数，放 `<chartPlot>` 全局或 `<chartSeries>` 单系列内）是数据标签，在柱 / 点 / 扇区上直接显示数值（常用属性 `position` / `value` / `category` / `percentage` / `format`）。两者别写反。`category` / `value` / `percentage` 至少一项为 `true`（默认仅 `value`）；`format` 用 Excel 数字格式码，如 `0`、`0%`、`#,##0.00`；单位要写进 `format` 时，格式码里的字面文本用双引号包（如 `0"bp"`），但直接写进 XML 属性会和属性外层双引号冲突、破坏 XML，必须改用单引号包属性值 `format='0"bp"'`，或把内层引号转义成 `format="0&quot;bp&quot;"`。
- `<chartLabels>` 的 `position` 按图表类型选：折线 / 散点用 `auto`（别用 `right`，会压线或出框）；柱状用 `top` 或 `inside`；饼 / 环用 `outside`。
- **标注图表上某个关键数据点 / 节点**（如折线的阶段性低点、反弹点），不要用 `<shape type="text">` 浮在绘图区上——文字盒会压到图表区，必触发 `bbox_overlap`。正确做法：优先在图表外的右侧 / 下方文字区用文字描述该节点，或给该系列开 `<chartLabels>` 只显示数值；确需就地标注时给 `<chart>` 预留上 / 下方专用标注带（缩小 chart 高度腾出空间），标注文字放在 chart 边界之外。
- `<chartColorTheme>` 只接受纯色 `<color value="rgb(...)"/>` / `rgba(...)`，**不支持渐变**（`linear-gradient` 等只对 `<shape>` 的 `<fill>` 有效）。想要渐变视觉的柱 / 面，用 `<shape>`+`<fill linear-gradient>` 自绘，或接受纯色。
- 详细用法见 [slides_xml_schema_definition.xml](slides_xml_schema_definition.xml)。

## 颜色与样式

### fill

**示例**

```xml
<fill>
  <fillColor color="rgb(255, 0, 0)"/>
</fill>
```

### border

**属性**

- `dashArray` 可选 `solid`（默认）/ `dash` / `dot` / `long-dash` / `round-dot` 等，完整取值见 schema。

**示例**

```xml
<border color="rgb(43, 47, 54)" width="2" dashArray="solid"/>
```

### 颜色格式

**注意事项**

- 颜色用 `rgb` / `rgba` 格式。
- 线性渐变使用明确的方向、`rgba()` 颜色和百分比停靠点，例如 `linear-gradient(135deg,rgba(30,60,114,1) 0%,rgba(59,130,246,1) 100%)`。本地径向渐变仅近似为首个色阶的纯色并告警；需要保真时使用纯色或线性渐变。

**示例**

```xml
<fillColor color="rgb(255, 0, 0)"/>
<fillColor color="rgba(255, 0, 0, 0.5)"/>
<fillColor color="linear-gradient(90deg, rgba(255,0,0,1) 0%, rgba(0,0,255,1) 100%)"/>
```

### 页面背景

**示例**

```xml
<!-- 纯色背景 -->
<slide>
  <style>
    <fill>
      <fillColor color="rgb(245, 245, 245)"/>
    </fill>
  </style>
</slide>

<!-- 渐变背景（必须用 rgba + 百分比停靠点） -->
<slide>
  <style>
    <fill>
      <fillColor color="linear-gradient(135deg,rgba(30,60,114,1) 0%,rgba(59,130,246,1) 100%)"/>
    </fill>
  </style>
</slide>
```

## note 示例

```xml
<note>
  <content textType="body">
    <p>这是演讲者备注，一般写 3-5 句演讲者可以直接使用的讲稿。</p>
  </content>
</note>
```

## 完整示例

```xml
<presentation xmlns="https://www.larkoffice.com/sml/2.0" width="960" height="540">
  <title>季度报告</title>
  <theme>
    <textStyles>
      <title fontFamily="Microsoft YaHei" fontSize="54" fontColor="rgba(0, 0, 0, 1)"/>
      <body fontFamily="Microsoft YaHei" fontSize="18" fontColor="rgba(43, 47, 54, 1)"/>
    </textStyles>
  </theme>
  <slide>
    <style>
      <fill>
        <fillColor color="rgb(245, 245, 245)"/>
      </fill>
    </style>
    <data>
      <shape type="text" topLeftX="80" topLeftY="72" width="760" height="100">
        <content textType="title" fontSize="36">
          <p>2024 年第一季度报告</p>
        </content>
      </shape>
      <shape type="text" topLeftX="80" topLeftY="200" width="520" height="180">
        <content textType="body" fontSize="16">
          <p>核心指标</p>
          <ul>
            <li><p>用户增长：+25%</p></li>
            <li><p>收入增长：+30%</p></li>
            <li><p>市场份额：15%</p></li>
          </ul>
        </content>
      </shape>
      <shape type="rect" topLeftX="660" topLeftY="180" width="180" height="140">
        <fill>
          <fillColor color="rgba(100, 149, 237, 0.25)"/>
        </fill>
        <border color="rgb(100, 149, 237)" width="2"/>
      </shape>
    </data>
    <note>
      <content textType="body">
        <p>讲到增长率时补充样本范围。</p>
      </content>
    </note>
  </slide>
</presentation>
```

## 详细参考

- [slides_xml_schema_definition.xml](slides_xml_schema_definition.xml)
- [slides_chart_demo.xml](slides_chart_demo.xml)
