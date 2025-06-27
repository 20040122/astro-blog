---
title: "逆向迁移LLVM-15：LowerGlobalDtors"
categories: Learning
tags: ['LLVM','Pass']
id: "4ee1cb6e0443ab26"
date: 2025-06-27 13:58:26
cover: "https://gcore.jsdelivr.net/gh/20040122/Image/c401ba32-c3db-4744-a0c1-d93ad1c25de4.jpg"
---

:::note
将 @llvm.global_dtors （LLVM 中记录 C++全局析构函数的机制）里的析构函数条目转换为调用 __cxa_atexit 注册函数，从而使它们在程序退出时被调用，同时消除 @llvm.global_dtors。
:::

# 思路转变

- 尝试仿照官方仓库将新增的Pass、写到Transforms/Utils目录下变成静态库，变为LLVM内置Pass。**优点**：调用Pass的时候不用使用-load去build/lib目录下找文件，直接写出想要的Pass名即可。**缺点：** 修改文件复杂需要改Transforms/Utils/CMakeList.txt、新加pass的cpp文件，tools/opt路径下需要修改opt.cpp和CMakeList.txt。修改不对opt会被污染需重新构建。试错成本比较高
- 写成动态库.so文件在Transforms目录下新建文件夹，添加CMakeList.txt(注意要添加MOUDLE声明是一个动态库)目录结构如下所示：

:::picture 

![image-20250627144652680](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250627144652680.png)

![image-20250627144718379](https://gcore.jsdelivr.net/gh/20040122/Image/image-20250627144718379.png)

:::

# 迁移LowerGlobalDtors流程

**1.** 阅读官方仓库源代码，对比15和13官方仓库差异。15新增了LowerGlobalDtors.cpp和LowerGlobalDtors.h
代码如下：



```c
#ifndef LLVM_TRANSFORMS_UTILS_LOWERGLOBALDTORS_H
#define LLVM_TRANSFORMS_UTILS_LOWERGLOBALDTORS_H

#include "llvm/IR/PassManager.h"

namespace llvm {

class LowerGlobalDtorsPass : public PassInfoMixin<LowerGlobalDtorsPass> {
public:
  PreservedAnalyses run(Module &M, ModuleAnalysisManager &AM);
};

} // namespace llvm

#endif // LLVM_TRANSFORMS_UTILS_LOWERGLOBALDTORS_H
```

```cpp
#include "llvm/Transforms/Utils/LowerGlobalDtors.h"

#include "llvm/IR/Constants.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Intrinsics.h"
#include "llvm/InitializePasses.h"
#include "llvm/Pass.h"
#include "llvm/Transforms/Utils.h"
#include "llvm/Transforms/Utils/ModuleUtils.h"
#include <map>

using namespace llvm;

#define DEBUG_TYPE "lower-global-dtors"

namespace {
class LowerGlobalDtorsLegacyPass final : public ModulePass {
  StringRef getPassName() const override {
    return "Lower @llvm.global_dtors via `__cxa_atexit`";
  }

  void getAnalysisUsage(AnalysisUsage &AU) const override {
    AU.setPreservesCFG();
    ModulePass::getAnalysisUsage(AU);
  }

  bool runOnModule(Module &M) override;

public:
  static char ID;
  LowerGlobalDtorsLegacyPass() : ModulePass(ID) {
    initializeLowerGlobalDtorsLegacyPassPass(*PassRegistry::getPassRegistry());
  }
};
} // End anonymous namespace

char LowerGlobalDtorsLegacyPass::ID = 0;
INITIALIZE_PASS(LowerGlobalDtorsLegacyPass, DEBUG_TYPE,
                "Lower @llvm.global_dtors via `__cxa_atexit`", false, false)

ModulePass *llvm::createLowerGlobalDtorsLegacyPass() {
  return new LowerGlobalDtorsLegacyPass();
}

static bool runImpl(Module &M);
bool LowerGlobalDtorsLegacyPass::runOnModule(Module &M) { return runImpl(M); }

PreservedAnalyses LowerGlobalDtorsPass::run(Module &M,
                                            ModuleAnalysisManager &AM) {
  bool Changed = runImpl(M);
  if (!Changed)
    return PreservedAnalyses::all();

  PreservedAnalyses PA;
  PA.preserveSet<CFGAnalyses>();
  return PA;
}

static bool runImpl(Module &M) {
  GlobalVariable *GV = M.getGlobalVariable("llvm.global_dtors");
  if (!GV || !GV->hasInitializer())
    return false;

  const ConstantArray *InitList = dyn_cast<ConstantArray>(GV->getInitializer());
  if (!InitList)
    return false;

  // Validate @llvm.global_dtor's type.
  auto *ETy = dyn_cast<StructType>(InitList->getType()->getElementType());
  if (!ETy || ETy->getNumElements() != 3 ||
      !ETy->getTypeAtIndex(0U)->isIntegerTy() ||
      !ETy->getTypeAtIndex(1U)->isPointerTy() ||
      !ETy->getTypeAtIndex(2U)->isPointerTy())
    return false; // Not (int, ptr, ptr).

  // Collect the contents of @llvm.global_dtors, ordered by priority. Within a
  // priority, sequences of destructors with the same associated object are
  // recorded so that we can register them as a group.
  std::map<
      uint16_t,
      std::vector<std::pair<Constant *, std::vector<Constant *>>>
  > DtorFuncs;
  for (Value *O : InitList->operands()) {
    auto *CS = dyn_cast<ConstantStruct>(O);
    if (!CS)
      continue; // Malformed.

    auto *Priority = dyn_cast<ConstantInt>(CS->getOperand(0));
    if (!Priority)
      continue; // Malformed.
    uint16_t PriorityValue = Priority->getLimitedValue(UINT16_MAX);

    Constant *DtorFunc = CS->getOperand(1);
    if (DtorFunc->isNullValue())
      break; // Found a null terminator, skip the rest.

    Constant *Associated = CS->getOperand(2);
    Associated = cast<Constant>(Associated->stripPointerCasts());

    auto &AtThisPriority = DtorFuncs[PriorityValue];
    if (AtThisPriority.empty() || AtThisPriority.back().first != Associated) {
        std::vector<Constant *> NewList;
        NewList.push_back(DtorFunc);
        AtThisPriority.push_back(std::make_pair(Associated, NewList));
    } else {
        AtThisPriority.back().second.push_back(DtorFunc);
    }
  }
  if (DtorFuncs.empty())
    return false;

  // extern "C" int __cxa_atexit(void (*f)(void *), void *p, void *d);
  LLVMContext &C = M.getContext();
  PointerType *VoidStar = Type::getInt8PtrTy(C);
  Type *AtExitFuncArgs[] = {VoidStar};
  FunctionType *AtExitFuncTy =
      FunctionType::get(Type::getVoidTy(C), AtExitFuncArgs,
                        /*isVarArg=*/false);

  FunctionCallee AtExit = M.getOrInsertFunction(
      "__cxa_atexit",
      FunctionType::get(Type::getInt32Ty(C),
                        {PointerType::get(AtExitFuncTy, 0), VoidStar, VoidStar},
                        /*isVarArg=*/false));

  // Declare __dso_local.
  Type *DsoHandleTy = Type::getInt8Ty(C);
  Constant *DsoHandle = M.getOrInsertGlobal("__dso_handle", DsoHandleTy, [&] {
    auto *GV = new GlobalVariable(M, DsoHandleTy, /*isConstant=*/true,
                                  GlobalVariable::ExternalWeakLinkage, nullptr,
                                  "__dso_handle");
    GV->setVisibility(GlobalVariable::HiddenVisibility);
    return GV;
  });

  // For each unique priority level and associated symbol, generate a function
  // to call all the destructors at that level, and a function to register the
  // first function with __cxa_atexit.
  for (auto &PriorityAndMore : DtorFuncs) {
    uint16_t Priority = PriorityAndMore.first;
    uint64_t Id = 0;
    auto &AtThisPriority = PriorityAndMore.second;
    for (auto &AssociatedAndMore : AtThisPriority) {
      Constant *Associated = AssociatedAndMore.first;
      auto ThisId = Id++;

      Function *CallDtors = Function::Create(
          AtExitFuncTy, Function::PrivateLinkage,
          "call_dtors" +
              (Priority != UINT16_MAX ? (Twine(".") + Twine(Priority))
                                      : Twine()) +
              (AtThisPriority.size() > 1 ? Twine("$") + Twine(ThisId)
                                         : Twine()) +
              (!Associated->isNullValue() ? (Twine(".") + Associated->getName())
                                          : Twine()),
          &M);
      BasicBlock *BB = BasicBlock::Create(C, "body", CallDtors);
      FunctionType *VoidVoid = FunctionType::get(Type::getVoidTy(C),
                                                 /*isVarArg=*/false);

      for (auto Dtor : reverse(AssociatedAndMore.second))
        CallInst::Create(VoidVoid, Dtor, "", BB);
      ReturnInst::Create(C, BB);

      Function *RegisterCallDtors = Function::Create(
          VoidVoid, Function::PrivateLinkage,
          "register_call_dtors" +
              (Priority != UINT16_MAX ? (Twine(".") + Twine(Priority))
                                      : Twine()) +
              (AtThisPriority.size() > 1 ? Twine("$") + Twine(ThisId)
                                         : Twine()) +
              (!Associated->isNullValue() ? (Twine(".") + Associated->getName())
                                          : Twine()),
          &M);
      BasicBlock *EntryBB = BasicBlock::Create(C, "entry", RegisterCallDtors);
      BasicBlock *FailBB = BasicBlock::Create(C, "fail", RegisterCallDtors);
      BasicBlock *RetBB = BasicBlock::Create(C, "return", RegisterCallDtors);

      Value *Null = ConstantPointerNull::get(VoidStar);
      Value *Args[] = {CallDtors, Null, DsoHandle};
      Value *Res = CallInst::Create(AtExit, Args, "call", EntryBB);
      Value *Cmp = new ICmpInst(*EntryBB, ICmpInst::ICMP_NE, Res,
                                Constant::getNullValue(Res->getType()));
      BranchInst::Create(FailBB, RetBB, Cmp, EntryBB);

      // If `__cxa_atexit` hits out-of-memory, trap, so that we don't misbehave.
      // This should be very rare, because if the process is running out of
      // memory before main has even started, something is wrong.
      CallInst::Create(Intrinsic::getDeclaration(&M, Intrinsic::trap), "",
                       FailBB);
      new UnreachableInst(C, FailBB);

      ReturnInst::Create(C, RetBB);

      // Now register the registration function with @llvm.global_ctors.
      appendToGlobalCtors(M, RegisterCallDtors, Priority, Associated);
    }
  }

  // Now that we've lowered everything, remove @llvm.global_dtors.
  GV->eraseFromParent();

  return true;
}
```

.h文件主要是写的PM的接口生声明，旧版PM不需要这个文件



**2.** 书写基于旧版PM的等价Pass

```cpp

#include "llvm/IR/Module.h"
#include "llvm/IR/GlobalVariable.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Intrinsics.h"
#include "llvm/InitializePasses.h"
#include "llvm/PassRegistry.h"
#include "llvm/Pass.h"
#include "llvm/Transforms/Utils.h"
#include "llvm/Transforms/Utils/ModuleUtils.h"
#include <map>


using namespace llvm;

#define DEBUG_TYPE "lower-global-dtors"

namespace {
class LowerGlobalDtorsLegacyPass final : public ModulePass {
  StringRef getPassName() const override {
    return "Lower @llvm.global_dtors via `__cxa_atexit`";
  }

  void getAnalysisUsage(AnalysisUsage &AU) const override {
    AU.setPreservesCFG();
    ModulePass::getAnalysisUsage(AU);
  }

  bool runOnModule(Module &M) override;

public:
  static char ID;
  LowerGlobalDtorsLegacyPass() : ModulePass(ID) {}
};
} // End anonymous namespace

char LowerGlobalDtorsLegacyPass::ID = 0;
static RegisterPass<LowerGlobalDtorsLegacyPass>
    X("lower-global-dtors", "Lower @llvm.global_dtors via `__cxa_atexit`");

namespace llvm {
ModulePass *createLowerGlobalDtorsLegacyPass() {
  return new LowerGlobalDtorsLegacyPass();
}
}

static bool runImpl(Module &M);
bool LowerGlobalDtorsLegacyPass::runOnModule(Module &M) { return runImpl(M); }

static bool runImpl(Module &M) {
  GlobalVariable *GV = M.getGlobalVariable("llvm.global_dtors");
  if (!GV || !GV->hasInitializer())
    return false;

  const ConstantArray *InitList = dyn_cast<ConstantArray>(GV->getInitializer());
  if (!InitList)
    return false;

  // Validate @llvm.global_dtor's type.
  auto *ETy = dyn_cast<StructType>(InitList->getType()->getElementType());
  if (!ETy || ETy->getNumElements() != 3 ||
      !ETy->getTypeAtIndex(0U)->isIntegerTy() ||
      !ETy->getTypeAtIndex(1U)->isPointerTy() ||
      !ETy->getTypeAtIndex(2U)->isPointerTy())
    return false; // Not (int, ptr, ptr).

  // Collect the contents of @llvm.global_dtors, ordered by priority. Within a
  // priority, sequences of destructors with the same associated object are
  // recorded so that we can register them as a group.
  std::map<
      uint16_t,
      std::vector<std::pair<Constant *, std::vector<Constant *>>>
  > DtorFuncs;
  for (Value *O : InitList->operands()) {
    auto *CS = dyn_cast<ConstantStruct>(O);
    if (!CS)
      continue; // Malformed.

    auto *Priority = dyn_cast<ConstantInt>(CS->getOperand(0));
    if (!Priority)
      continue; // Malformed.
    uint16_t PriorityValue = Priority->getLimitedValue(UINT16_MAX);

    Constant *DtorFunc = CS->getOperand(1);
    if (DtorFunc->isNullValue())
      break; // Found a null terminator, skip the rest.

    Constant *Associated = CS->getOperand(2);
    Associated = cast<Constant>(Associated->stripPointerCasts());

    auto &AtThisPriority = DtorFuncs[PriorityValue];
    if (AtThisPriority.empty() || AtThisPriority.back().first != Associated) {
        std::vector<Constant *> NewList;
        NewList.push_back(DtorFunc);
        AtThisPriority.push_back(std::make_pair(Associated, NewList));
    } else {
        AtThisPriority.back().second.push_back(DtorFunc);
    }
  }
  if (DtorFuncs.empty())
    return false;

  // extern "C" int __cxa_atexit(void (*f)(void *), void *p, void *d);
  LLVMContext &C = M.getContext();
  PointerType *VoidStar = Type::getInt8PtrTy(C);
  Type *AtExitFuncArgs[] = {VoidStar};
  FunctionType *AtExitFuncTy =
      FunctionType::get(Type::getVoidTy(C), AtExitFuncArgs,
                        /*isVarArg=*/false);

  FunctionCallee AtExit = M.getOrInsertFunction(
      "__cxa_atexit",
      FunctionType::get(Type::getInt32Ty(C),
                        {PointerType::get(AtExitFuncTy, 0), VoidStar, VoidStar},
                        /*isVarArg=*/false));

  // Declare __dso_local.
  Type *DsoHandleTy = Type::getInt8Ty(C);
  Constant *DsoHandle = M.getOrInsertGlobal("__dso_handle", DsoHandleTy, [&] {
    auto *GV = new GlobalVariable(M, DsoHandleTy, /*isConstant=*/true,
                                  GlobalVariable::ExternalWeakLinkage, nullptr,
                                  "__dso_handle");
    GV->setVisibility(GlobalVariable::HiddenVisibility);
    return GV;
  });

  // For each unique priority level and associated symbol, generate a function
  // to call all the destructors at that level, and a function to register the
  // first function with __cxa_atexit.
  for (auto &PriorityAndMore : DtorFuncs) {
    uint16_t Priority = PriorityAndMore.first;
    uint64_t Id = 0;
    auto &AtThisPriority = PriorityAndMore.second;
    for (auto &AssociatedAndMore : AtThisPriority) {
      Constant *Associated = AssociatedAndMore.first;
      auto ThisId = Id++;

      Function *CallDtors = Function::Create(
          AtExitFuncTy, Function::PrivateLinkage,
          "call_dtors" +
              (Priority != UINT16_MAX ? (Twine(".") + Twine(Priority))
                                      : Twine()) +
              (AtThisPriority.size() > 1 ? Twine("$") + Twine(ThisId)
                                         : Twine()) +
              (!Associated->isNullValue() ? (Twine(".") + Associated->getName())
                                          : Twine()),
          &M);
      BasicBlock *BB = BasicBlock::Create(C, "body", CallDtors);
      FunctionType *VoidVoid = FunctionType::get(Type::getVoidTy(C),
                                                 /*isVarArg=*/false);

      for (auto Dtor : reverse(AssociatedAndMore.second))
        CallInst::Create(VoidVoid, Dtor, "", BB);
      ReturnInst::Create(C, BB);

      Function *RegisterCallDtors = Function::Create(
          VoidVoid, Function::PrivateLinkage,
          "register_call_dtors" +
              (Priority != UINT16_MAX ? (Twine(".") + Twine(Priority))
                                      : Twine()) +
              (AtThisPriority.size() > 1 ? Twine("$") + Twine(ThisId)
                                         : Twine()) +
              (!Associated->isNullValue() ? (Twine(".") + Associated->getName())
                                          : Twine()),
          &M);
      BasicBlock *EntryBB = BasicBlock::Create(C, "entry", RegisterCallDtors);
      BasicBlock *FailBB = BasicBlock::Create(C, "fail", RegisterCallDtors);
      BasicBlock *RetBB = BasicBlock::Create(C, "return", RegisterCallDtors);

      Value *Null = ConstantPointerNull::get(VoidStar);
      Value *Args[] = {CallDtors, Null, DsoHandle};
      Value *Res = CallInst::Create(AtExit, Args, "call", EntryBB);
      Value *Cmp = new ICmpInst(*EntryBB, ICmpInst::ICMP_NE, Res,
                                Constant::getNullValue(Res->getType()));
      BranchInst::Create(FailBB, RetBB, Cmp, EntryBB);

      // If `__cxa_atexit` hits out-of-memory, trap, so that we don't misbehave.
      // This should be very rare, because if the process is running out of
      // memory before main has even started, something is wrong.
      CallInst::Create(Intrinsic::getDeclaration(&M, Intrinsic::trap), "",
                       FailBB);
      new UnreachableInst(C, FailBB);

      ReturnInst::Create(C, RetBB);

      // Now register the registration function with @llvm.global_ctors.
      appendToGlobalCtors(M, RegisterCallDtors, Priority, Associated);
    }
  }

  // Now that we've lowered everything, remove @llvm.global_dtors.
  GV->eraseFromParent();

  return true;
}

```

工作如下：

> - 去掉了新 PassManager 支持，用legacy pass实现
> - 注册方式从 INITIALIZE_PASS 改为 RegisterPass
> - 进行调整，如15提供了 llvm::createLowerGlobalDtorsLegacyPass() 工厂函数，13工厂函数 createLowerGlobalDtorsLegacyPass 放在 namespace llvm 里。



`LowerGlobalDtors` Pass 将 IR 中的高级语义（global_dtors）替换为具体的运行时调用，使之能被后端正确生成机器码。

| 目标                      | 说明                                                         |
| ------------------------- | ------------------------------------------------------------ |
| 转换 `@llvm.global_dtors` | 将 IR 中抽象的析构信息转为调用 `__cxa_atexit` 的显式注册函数 |
| 支持动态库卸载            | `__cxa_atexit` 是 C++ ABI 标准做法，能按 DSO 卸载安全调用析构器 |
| 减少平台相关特殊处理      | 一旦 lowered，就不需要特殊处理 `@llvm.global_dtors` 了       |

作用：

- **便于优化：** 析构器逻辑以显式函数表现形式存在，有助于其他 Pass（如 DCE、IPO）识别和处理
- **增强可移植性：** 减少 `@llvm.global_dtors` 这种特殊变量带来的兼容负担
- 把注册函数变成普通 IR 函数，有利于跨模块内联、裁剪、函数重排等优化。



# 验证
1.准备test.ll

```
; ModuleID = 'test'
target triple = "x86_64-unknown-linux-gnu"
target datalayout = ""

; Define a simple destructor function
define void @my_dtor() {
entry:
  ret void
}

; Define a struct type to store the destructor information
%struct.dtor = type { i32, void ()*, i8* }

; Define the global dtors array
@llvm.global_dtors = appending global [1 x %struct.dtor] [
  %struct.dtor { i32 65535, void ()* @my_dtor, i8* null }
]

```

> 简单的析构函数 `@my_dtor`空的析构函数，它什么都不做，仅仅是返回。它是注册在 `llvm.global_dtors` 中的析构函数。
>
> 全局变量是一个包含析构函数信息的数组，数组的每个元素表示一个析构函数的描述。

2.用两个版本的opt一个是llvm13自己写的，一个是llvm15内置的。

```shell
#13.0.0
/usr/local/llvm-13/bin/opt -load ./lib/LowerGlobalDtors.so -lower-global-dtors -enable-new-pm=0 -S test.ll -o output.ll
#15.0.0
/usr/lib/llvm-15/bin/opt  -lower-global-dtors -enable-new-pm=0 -S test.ll -o output2.ll
```

3.对比output.ll和output2.ll内容完全一样。

```
; ModuleID = 'test.ll'
source_filename = "test.ll"
target triple = "x86_64-unknown-linux-gnu"

@__dso_handle = extern_weak hidden constant i8
@llvm.global_ctors = appending global [1 x { i32, void ()*, i8* }] [{ i32, void ()*, i8* } { i32 65535, void ()* @register_call_dtors, i8* null }]

define void @my_dtor() {
entry:
  ret void
}

declare i32 @__cxa_atexit(void (i8*)*, i8*, i8*)

define private void @call_dtors(i8* %0) {
body:
  call void @my_dtor()
  ret void
}

define private void @register_call_dtors() {
entry:
  %call = call i32 @__cxa_atexit(void (i8*)* @call_dtors, i8* null, i8* @__dso_handle)
  %0 = icmp ne i32 %call, 0
  br i1 %0, label %fail, label %return

fail:                                             ; preds = %entry
  call void @llvm.trap()
  unreachable

return:                                           ; preds = %entry
  ret void
}

; Function Attrs: cold noreturn nounwind
declare void @llvm.trap() #0

attributes #0 = { cold noreturn nounwind }
```

> **将 `llvm.global_dtors` 转换为 `__cxa_atexit` 注册函数**：
>
> - Pass 处理 `@llvm.global_dtors`，从中提取析构函数的信息，并将其转换为使用 `__cxa_atexit` 注册析构函数。
> - `__cxa_atexit` 是 C++ 中用于注册析构函数的标准函数。每次程序退出时，它会调用注册的析构函数。
>
> **生成辅助函数**：
>
> Pass 会生成一些辅助函数，来实现析构函数的注册和调用。这些函数如下：
>
> - `@call_dtors`：这个函数会调用所有注册的析构函数（在这个例子中是 `@my_dtor`）。
> - `@register_call_dtors`：这个函数使用 `__cxa_atexit` 来注册 `@call_dtors`，表示程序退出时会调用 `@call_dtors` 中的析构函数。
