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
