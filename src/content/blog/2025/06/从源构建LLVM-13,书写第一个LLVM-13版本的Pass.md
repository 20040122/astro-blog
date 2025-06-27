---
title: "从源构建LLVM-13,书写第一个LLVM-13版本的Pass"
categories: Learning
tags: ['LLVM']
id: "a2b3aa62586bc8d5"
date: 2025-06-22 13:36:43
recommend: true
top: true
cover: "https://gcore.jsdelivr.net/gh/20040122/Image/c401ba32-c3db-4744-a0c1-d93ad1c25de4.jpg"
---

:::note{type="success"}

本节介绍了如何在8核16线程的硬件条件下，从源码构建LLVM-13，并书写第一个LLVM-13版本的Pass。
:::

> 部署申威版本LLVM-13


# 一、本地构建编译LLVM-13.0.0官方仓库流程：

**1.git clone仓库切换分支**

```shell
git clone https://github.com/llvm/llvm-project.git
cd llvm-project
git checkout llvmorg-13.0.0 
```

**2.进入llvm-project目录创建build进行构建**

```shell
mkdir build && cd build

cmake -G Ninja \
  -DLLVM_ENABLE_PROJECTS="clang;lld" \
  -DLLVM_TARGETS_TO_BUILD="X86" \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_ENABLE_RTTI=ON \
  -DLLVM_ENABLE_WERROR=OFF \
  -DCMAKE_INSTALL_PREFIX=/usr/local/llvm-13 \
  ../llvm
```

**3.利用ninja进行编译安装**

```shell
ninja -j4

sudo ninja install
```



:::note{type="warning"}

（申威同样遇到）遇到的第一个问题，编译不通过：
:::

![image-20250622135612878](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250622135612878.png)

> 解决方法：
>
> 根据提示信息进入~/llvm-project/llvm/include/llvm/Support路径下，找到
>
> ![image-20250622140219933](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250622140219933.png)
>
> 添加标准库头文件

```c
#include <cstdint>
```

:::note{type="warning"}

遇到的第二个问题，编译突然终止：
:::

![image-20250622140738937](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250622140738937.png)

> 解决方法：调小ninja -j后面的数字，防止OOM内存溢出



**成功构建编译后的状态：**

![image-20250622140911935](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250622140911935.png)

**验证clang和llvm版本**

![image-20250622141040062](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250622141040062.png)



# 二、编写Pass流程：

**1.首先明确路径关系**

![image-20250622181325205](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250622181325205.png)

> 优点：
>
> 1.和 LLVM 原生 pass 结构保持一致
>
> 2.易于集成进 LLVM 编译系统
>
> 3.后续编译方便，维护简单

**2.编写FunctionCount.cpp**

```cpp
#include "llvm/Pass.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/Module.h"
#include "llvm/Support/raw_ostream.h"

using namespace llvm;

namespace {
struct FunctionCount : public ModulePass {
  static char ID;
  FunctionCount() : ModulePass(ID) {}

  bool runOnModule(Module &M) override {
    errs() << "Number of functions: " << M.size() << "\n";
    return false;
  }
};

char FunctionCount::ID = 0;
static RegisterPass<FunctionCount> X("func-count", "Count Functions Pass");
}

```

**3.写llvm-project/llvm/lib/Transforms/FunctionCount/CMakeLists.txt文件**

```
add_llvm_library(FunctionCount MODULE
  FunctionCount.cpp

  DEPENDS
  intrinsics_gen
)

```

> 用 MODULE 表示生成 .so 动态插件
>
> 列出你的 .cpp 文件
>
> 加上必要依赖

**4.在llvm-project/llvm/lib/Transforms/CMakeLists.txt添加**

```
add_subdirectory(FunctionCount)
```

> 这样 LLVM 编译系统才知道你的新 pass 存在，要把它包含进来。

**5.在llvm-project/build重新编译**

```
ninja FunctionCount
```

**6.在llvm-project/build/lib下查看FunctionCount.so文件**



# 三、验证pass：

**1.准备test.c文件**

```c
#include <stdio.h>

void foo() {
    printf("In foo\n");
}

void bar() {
    printf("In bar\n");
}

int main() {
    foo();
    bar();
    return 0;
}

```

**2.利用/usr/local/llvm-13/bin/clang生成test.bc文件**

```shell
/usr/local/llvm-13/bin/clang -O0 -emit-llvm -c test.c -o test.bc
```

> -O0：关闭优化（便于分析）
>
> -emit-llvm：告诉编译器生成 LLVM 中间表示（IR），不是目标代码
>
> -c：只编译，不链接
>
> -o test.bc：输出文件为 LLVM bitcode（.bc）文

**3.利用/usr/local/llvm-13/bin/opt优化test.bc**

```shell
/usr/local/llvm-13/bin/opt -load ./lib/FunctionCount.so -func-count -enable-new-pm=0 test.bc -o /dev/null
```

:::note{type="warning"}

！！！！！！-enable-new-pm=0一定要加，原因是opt 默认使用的是新 Pass Manager（New PM），写的 pass 基于旧 Pass Manager（Legacy PM） 。不加会一直报错，一定要加！！！！！
:::

**最终这个分析pass的效果：**

![image-20250622143616435](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250622143616435.png)