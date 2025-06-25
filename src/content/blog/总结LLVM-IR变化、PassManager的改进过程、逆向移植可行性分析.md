---
title: "总结LLVM-IR变化、PassManager的改进过程、逆向移植可行性分析"
categories: Learning
tags: ['LLVM']
id: "277c69563fdeaa91"
date: 2025-06-24 16:18:58
cover: "https://gcore.jsdelivr.net/gh/20040122/Image/c401ba32-c3db-4744-a0c1-d93ad1c25de4.jpg"
---

:::note
阅读官方文档，提取有用信息，总结LLVM-IR变化、PassManager的改进过程、逆向移植可行性分析
:::

# 官方文档LLVM IR 变更汇总（v13.0.0 - v18.1.8）



# 13.0.0

# LLVM IR 变更

- `inalloca` 属性现在必须包含类型字段（类似 `byval` 和 `sret`）。
- 引入不透明指针类型 `ptr`（尚未稳定，不建议使用）。
- **使用 legacy pass manager 进行优化的方式已被弃用**，将在 LLVM 14 移除。

# C API 更改

- 支持调用新的 pass manager。
- 删除了 `LLVMPassBuilderOptionsSetCoroutines`（协程 pass 默认启用）。

---



# 14.0.0

# LLVM IR 变更

- **继续弃用 legacy pass manager**，计划在 LLVM 14 后移除。
- 最大整数类型从 `2^24-1` 位缩减为 `2^23` 位。
- 最大对齐值从 `2^29` 增加到 `2^32`。



# 15.0.0

# LLVM IR 变更

- 使用不透明指针，所有具体类型的指针（如 `i8*`, `i32*`, `void()**` 等）统一为 `ptr` 类型。
- 重命名 Intrinsic：
  - `llvm.experimental.vector.extract` → `llvm.vector.extract`
  - `llvm.experimental.vector.insert` → `llvm.vector.insert`
- **移除常量表达式支持**：如 `udiv`, `fadd`, `insertvalue` 等。
- **`atomicrmw` 支持新增**：加入 `fmax` 和 `fmin`
- **`callbr` 不再使用 `blockaddress`**，改为使用 `!` 引用目标块。



# 16.0.0

# LLVM IR 变更

- 以下函数属性统一被替换为 `memory(...)`：

  | 原属性                                    | 新属性表达式                                            |
  | ----------------------------------------- | ------------------------------------------------------- |
  | `readnone`                                | `memory(none)`                                          |
  | `readonly`                                | `memory(read)`                                          |
  | `writeonly`                               | `memory(write)`                                         |
  | `argmemonly`                              | `memory(argmem: readwrite)`                             |
  | `argmemonly readonly`                     | `memory(argmem: read)`                                  |
  | `argmemonly writeonly`                    | `memory(argmem: write)`                                 |
  | `inaccessiblememonly`                     | `memory(inaccessiblemem: readwrite)`                    |
  | `inaccessiblememonly readonly`            | `memory(inaccessiblemem: read)`                         |
  | `inaccessiblememonly writeonly`           | `memory(inaccessiblemem: write)`                        |
  | `inaccessiblemem_or_argmemonly`           | `memory(argmem: readwrite, inaccessiblemem: readwrite)` |
  | `inaccessiblemem_or_argmemonly readonly`  | `memory(argmem: read, inaccessiblemem: read)`           |
  | `inaccessiblemem_or_argmemonly writeonly` | `memory(argmem: write, inaccessiblemem: write)`         |

- 删除常量表达式版本指令：

  - `fneg`

- 新增：

  - Target extension types
  - `uinc_wrap` 和 `udec_wrap` 用于 `atomicrmw`
  - `llvm.flt.rounds` 更名为 `llvm.get.rounding`

---



# 17.0.1

# LLVM IR 变更

- **Typed pointers 不再支持，移除 `-opaque-pointers` 选项**。
- 新增 `nofpclass` 属性，用于优化浮点比较。
- 新增 intrinsic：
  - `llvm.ldexp`
  - `llvm.experimental.constrained.ldexp`
  - `llvm.frexp`
- 删除常量表达式版本指令：
  - `select`
- 新增实验性：
  - convergence control intrinsics，用于控制并发语义

# C API & Pass 管理器

- **完全移除 legacy pass manager 接口**：
  - `LLVMAddInstructionCombiningPass`
  - `LLVMInitializeInstCombine`
  - `LLVMPassManagerBuilderRef`
  - `LLVMPassRegistryRef`
- 删除 inline pass 中的 alloca 合并（由后端 stack coloring 代替）

---



# 18.1.8

# LLVM IR 变更

- `llvm.stacksave` 和 `llvm.stackrestore` 现在支持重载指针类型（支持非 0 地址空间）。
- 删除常量表达式版本指令：
  - `and`, `or`, `lshr`, `ashr`, `zext`, `sext`
  - `fptrunc`, `fpext`, `fptoui`, `fptosi`, `uitofp`, `sitofp`
- 新增 intrinsic：
  - `llvm.exp10`
- 新增：
  - `code_model` 属性（用于全局变量）

---

# 总结表

| 类别           | 内容                             | 涉及版本        |
| -------------- | -------------------------------- | --------------- |
| 属性统一       | `memory(...)` 替换旧属性         | 16.0.0          |
| 浮点优化       | `nofpclass` 属性                 | 17.0.1          |
| 指针类型       | `ptr` 引入 / typed pointers 删除 | 13.0.0 / 17.0.1 |
| 常量表达式删除 | 多个 IR 指令不再支持常量表达式   | 16.0.0 - 18.1.8 |
| Pass 管理器    | legacy pass manager 弃用并删除   | 13.0.0 - 17.0.1 |
| intrinsic 增补 | `ldexp`, `frexp`, `exp10` 等     | 17.0.1 - 18.1.8 |

---




# LLVM 13.0.0 能否完全使用新的 Pass Manager？

**不成熟**。LLVM 13.0.0 提供了新的 Pass Manager，并允许你使用它，但**某些功能（尤其是 C API 和部分 pass）在这个版本中尚未完全迁移或支持**。

默认支持新的 Pass Manager，所以之前小节讲的必须要禁用新的PM模式。C API 对新 PM 的支持还比较初步。

LLVM 13的`opt`工具默认只支持**Legacy PassManager**的老式Pass，或者是**静态编译进opt里的新PM Pass插件**。

`llvm::PassPluginLibraryInfo` 和插件接口是 **LLVM14+** 新增的。



 对比新版PM和老版PM仓库源码

- 新增后端CodeGenPassBuilder.cpp


> 作用：为 LLVM 后端代码生成阶段的 MachineFunction 分析 Pass 注册唯一的 AnalysisKey。



- 新增OptimizationLevel.cpp


> 作用：定义了 LLVM 编译器支持的几个标准优化等级（O0, O1, O2, O3, Os, Oz）对应的优化级别（速度 vs 大小）。



> | 特性              | LLVM 19                                   | LLVM 13                 |
> | ----------------- | ----------------------------------------- | ----------------------- |
> | 默认 PM           | 新 PM                                     | 旧 PM                   |
> | Pass 接口         | `PassInfoMixin<T>`                        | `FunctionPass` 等       |
> | Pipeline 注册方式 | 字符串表达式、PassBuilder                 | 明确的 `addPass()` 调用 |
> | 内部结构          | 模块化、按需构建                          | 手动注册与依赖分析      |
> | 部分 Pass         | 新增如 `MLInlinerPass`、`LoopFlattenPass` | 不存在                  |



# 逆向移植高版本优化Pass至LLVM-13.0.0可行性分析

- 代码量大，依赖关系多。例如效果好的LoopIdiomVectorize这个Pass，cpp规模如下：

![image-20250624124451801](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250624124451801.png)

依赖的头文件有差异需要逐层修改、工作量很大

![image-20250624125910011](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250624125910011.png)

![image-20250624125938003](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250624125938003.png)

结论：依赖关系少的分析Pass逆向移植成功性可能大，但不确定是否有意义。优化效果好的优化Pass逆向迁移，依赖关系多太过复杂、成功性低。

# 对比不同版本LLVM新增的Pass（统计14-16版本，旧PM废除之前)


```shell
git diff --name-status llvmorg-13.0.0 llvmorg-14.0.0 -- llvm/lib/Transforms/ | grep '^A'
git diff --name-status llvmorg-13.0.0 llvmorg-14.0.0 -- llvm/include/llvm/Transforms/ | grep '^A'
```



# 14.0.0：

 A	llvm/lib/Transforms/IPO/ModuleInliner.cpp

 A	llvm/lib/Transforms/Utils/CodeLayout.cpp

 A	llvm/lib/Transforms/Utils/SampleProfileInference.cpp

 A	llvm/include/llvm/Transforms/IPO/ModuleInliner.h

 A	llvm/include/llvm/Transforms/Scalar/FlattenCFG.h

 A	llvm/include/llvm/Transforms/Utils/CodeLayout.h

 A	llvm/include/llvm/Transforms/Utils/SampleProfileInference.h

| Pass 名称                | 路径                                   | 简介                                                 |
| ------------------------ | -------------------------------------- | ---------------------------------------------------- |
| `ModuleInliner`          | `IPO/ModuleInliner.{cpp,h}`            | 模块级内联器（替代原有的内联行为控制方式）           |
| `CodeLayout`             | `Utils/CodeLayout.{cpp,h}`             | 代码布局优化器，用于基本块重排序等                   |
| `SampleProfileInference` | `Utils/SampleProfileInference.{cpp,h}` | 通过抽样信息进行性能导向的路径推断                   |
| `FlattenCFG`（头文件）   | `Scalar/FlattenCFG.h`                  | 控制流图扁平化（虽为头文件，可能表示结构或辅助功能） |

# 15.0.0：

 A	llvm/lib/Transforms/Coroutines/CoroConditionalWrapper.cpp

 A	llvm/lib/Transforms/Scalar/TLSVariableHoist.cpp

 A	llvm/lib/Transforms/Utils/LowerAtomic.cpp

 A	llvm/lib/Transforms/Utils/LowerGlobalDtors.cpp

 A	llvm/lib/Transforms/Utils/MemoryTaggingSupport.cpp

 A	llvm/lib/Transforms/Utils/MisExpect.cpp

 A	llvm/lib/Transforms/Vectorize/VPlanRecipes.cpp

 A	llvm/include/llvm/Transforms/Coroutines/CoroConditionalWrapper.h

 A	llvm/include/llvm/Transforms/Scalar/TLSVariableHoist.h

 A	llvm/include/llvm/Transforms/Utils/LowerAtomic.h

 A	llvm/include/llvm/Transforms/Utils/LowerGlobalDtors.h

 A	llvm/include/llvm/Transforms/Utils/MemoryTaggingSupport.h

 A	llvm/include/llvm/Transforms/Utils/MisExpect.h

| Pass 名称                | 路径                                        | 简介                                              |
| ------------------------ | ------------------------------------------- | ------------------------------------------------- |
| `CoroConditionalWrapper` | `Coroutines/CoroConditionalWrapper.{cpp,h}` | 协程条件包装器，优化协程状态切换                  |
| `TLSVariableHoist`       | `Scalar/TLSVariableHoist.{cpp,h}`           | 提升线程局部变量访问至更高作用域                  |
| `LowerAtomic`            | `Utils/LowerAtomic.{cpp,h}`                 | 降低原子操作至平台兼容的实现                      |
| `LowerGlobalDtors`       | `Utils/LowerGlobalDtors.{cpp,h}`            | 降低全局析构函数处理逻辑                          |
| `MemoryTaggingSupport`   | `Utils/MemoryTaggingSupport.{cpp,h}`        | 内存打标签支持，配合内存安全相关工具（如 HWASAN） |
| `MisExpect`              | `Utils/MisExpect.{cpp,h}`                   | 检测 `__builtin_expect` 使用是否合理              |
| `VPlanRecipes`（辅助）   | `Vectorize/VPlanRecipes.cpp`                | 向量化计划表示的实现模块，辅助 `LoopVectorize`    |

# 16.0.0

 A	llvm/lib/Transforms/Instrumentation/KCFI.cpp

 A	llvm/lib/Transforms/Instrumentation/SanitizerBinaryMetadata.cpp

 A	llvm/lib/Transforms/Utils/LowerIFunc.cpp

 A	llvm/lib/Transforms/Vectorize/VPlanCFG.h

 A	llvm/include/llvm/Transforms/IPO/ExtractGV.h

 A	llvm/include/llvm/Transforms/IPO/FunctionSpecialization.h

 A	llvm/include/llvm/Transforms/Instrumentation/KCFI.h

 A	llvm/include/llvm/Transforms/Instrumentation/SanitizerBinaryMetadata.h

 A	llvm/include/llvm/Transforms/Utils/LowerIFunc.h

| Pass 名称                          | 路径                                              | 简介                                      |
| ---------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| `KCFI`                             | `Instrumentation/KCFI.{cpp,h}`                    | 内核控制流完整性支持，增强内核 CFI 防护   |
| `SanitizerBinaryMetadata`          | `Instrumentation/SanitizerBinaryMetadata.{cpp,h}` | 添加二进制级元数据支持（如 ASAN/MSAN 等） |
| `LowerIFunc`                       | `Utils/LowerIFunc.{cpp,h}`                        | 降低 indirect function（IFunc）语义       |
| `ExtractGV`（头文件）              | `IPO/ExtractGV.h`                                 | 全局变量抽取 Pass 接口                    |
| `FunctionSpecialization`（头文件） | `IPO/FunctionSpecialization.h`                    | 函数专用化机制接口                        |
| `VPlanCFG`（头文件）               | `Vectorize/VPlanCFG.h`                            | VPlan 向量化控制流图结构（辅助向量化）    |

# 总结：

| LLVM 版本 | 新增 Pass 数量（含辅助模块） |
| --------- | ---------------------------- |
| 14.0.0    | 4                            |
| 15.0.0    | 7                            |
| 16.0.0    | 6                            |

部分模块（如 `VPlanRecipes`, `VPlanCFG`）可能不直接作为 Pass 注册，而是作为 Pass 的内部工具或辅助结构出现。

# 移植：

| 优先级 | Pass                     |
| ------ | ------------------------ |
| 1️⃣      | `FunctionSpecialization` |
| 2️⃣      | `LowerAtomic`            |
| 3️⃣      | `FlattenCFG`（增强）     |
| 4️⃣      | `TLSVariableHoist`       |
| 5️⃣      | `LowerIFunc`             |

