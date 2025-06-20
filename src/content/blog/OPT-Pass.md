---
title: "OPT-Pass"
categories: Learning
tags: ['LLVM','Optimization']
id: "5112545ed03959da"
date: 2025-06-19 21:00:00
cover: "https://gcore.jsdelivr.net/gh/20040122/Image/c401ba32-c3db-4744-a0c1-d93ad1c25de4.jpg"
---

:::note
LLVM Pass Framework 是 对 LLVM 中间表示（IR, Intermediate Representation）进行分析和转换的模块化结构。
:::



1. **安装LLVM**

```shell
wget -O - https://apt.llvm.org/llvm-snapshot.gpg.key | sudo apt-key add -

sudo apt-add-repository "deb http://apt.llvm.org/jammy/ llvm-toolchain-jammy-19 main"
# 注意这里将 "llvm-toolchain-jammy-19" 改为 "llvm-toolchain-jammy-13"
sudo apt-add-repository "deb http://apt.llvm.org/jammy/ llvm-toolchain-jammy-13 main"

sudo apt-get update

sudo apt-get install -y llvm-19 llvm-19-dev llvm-19-tools clang-19
# 安装 LLVM 13 和 Clang 13
sudo apt-get install -y llvm-13 llvm-13-dev llvm-13-tools clang-13
```

 从源构建LLVM  (Ubuntu 24.04.2 LTS)（4小时)![image-20250619234704468](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250619234704468.png)

```shell
git clone https://github.com/llvm/llvm-project.git
cd llvm-project
git checkout release/19.x
mkdir build
cd build
cmake -DCMAKE_BUILD_TYPE=Release -DLLVM_TARGETS_TO_BUILD=host -DLLVM_ENABLE_PROJECTS=clang <llvm-project/root/dir>/llvm/
cmake --build .
```

2. **构建llvm-tutor** 

```shell
cd ~/llvm-tutor/build
cmake -DLT_LLVM_INSTALL_DIR=/usr/lib/llvm-19 ~/llvm-tutor
make
```

![image-20250619232233588](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250619232233588.png)

安装lit

```shell
pipx install lit
```

test

```shell
lit ~/llvm-tutor/build/test
```

![image-20250619232157673](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250619232157673.png)



## HelloWorld Pass

- 清除cmake缓存

```shell
rm -rf build
mkdir build
cd build
cmake -DLT_LLVM_INSTALL_DIR=/usr/lib/llvm-19 ~/llvm-tutor/HelloWorld/
make 

```

![image-20250620100725342](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250620100725342.png)

- 准备测试文件（LLVM IR文件)

```shell
# Generate an LLVM test file
/usr/lib/llvm-19/bin/clang -O1 -S -emit-llvm ~/llvm-tutor/inputs/input_for_hello.c -o input_for_hello.ll
#-S 用于生成*.ll文件
```

- opt运行

```shell
/usr/lib/llvm-19/bin/opt -load-pass-plugin ./libHelloWorld.so -passes=hello-world -disable-output input_for_hello.ll
```

![image-20250620101145946](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250620101145946.png)

编译pass、生成IR、运行opt



## Overview Pass

![image-20250620103113350](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250620103113350.png)



### OpcodeCounter

> - 类型：分析Pass
> - 作用：分析每个函数中使用了哪些 LLVM 指令（Opcode），打印统计摘要。



顶层构建包括所有Pass

```shell
rm -rf build
mkdir build
cd build
cmake -DLT_LLVM_INSTALL_DIR=/usr/lib/llvm-19 ..
make 
```



```shell
export LLVM_DIR=/usr/lib/llvm-19
# Generate an LLVM file to analyze
$LLVM_DIR/bin/clang -emit-llvm -c ~/llvm-tutor/inputs/input_for_cc.c -o input_for_cc.bc
# Run the pass through opt
$LLVM_DIR/bin/opt -load-pass-plugin ~/llvm-tutor/build/lib/libOpcodeCounter.so --passes="print<opcode-counter>" -disable-output input_for_cc.bc
```

![image-20250620110732845](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250620110732845.png)

## InjectFuncCall

> - 类型：代码插桩（转换Pass）
> - 作用：对每个函数插入一条 `printf` 调用，打印函数信息。

```shell
export LLVM_DIR=/usr/lib/llvm-19
# Generate an LLVM file to analyze
$LLVM_DIR/bin/clang -O0 -emit-llvm -c ~/llvm-tutor/inputs/input_for_hello.c -o input_for_hello.bc
# Run the pass through opt
$LLVM_DIR/bin/opt -load-pass-plugin ~/llvm-tutor/build/lib/libInjectFuncCall.so --passes="inject-func-call" input_for_hello.bc -o instrumented.bin

$LLVM_DIR/bin/lli instrumented.bin
```

![image-20250620113444197](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250620113444197.png)

对比：

![image-20250620114217869](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250620114217869.png)

## StaticCallCounter

> - 类型：分析Pass
>
> - 作用：用于统计静态直接函数调用次数的分析 Pass，不考虑运行时行为或函数指针调用。

![image-20250620130556384](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250620130556384.png)

```shell
export LLVM_DIR=/usr/lib/llvm-19
# Generate an LLVM file to analyze
$LLVM_DIR/bin/clang -emit-llvm -c ~/llvm-tutor/inputs/input_for_cc.c -o input_for_cc.bc
# Run the pass through opt
$LLVM_DIR/bin/opt -load-pass-plugin ~/llvm-tutor/build/lib/libStaticCallCounter.so -passes="print<static-cc>" -disable-output input_for_cc.bc
```

![image-20250620131217757](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250620131217757.png)

通过static启动

```shell
~/llvm-tutor/build/bin/static input_for_cc.bc
```

