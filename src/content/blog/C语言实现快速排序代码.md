---
title: "C语言实现快速排序代码"
categories: Code
tags: ['C语言', '快速排序']
id: "af91a48c4902a098"
recommend: true
date: 2024-01-27 12:00:00
cover: "https://gcore.jsdelivr.net/gh/20040122/Image/88547067cd8ec211586177a8c1f00b39.webp"
top: false
---

# 快速排序实现

<!-- more -->

- # 概述：“分治”+“递归”

- # 具体描述：

> “分治”：分而治之，首先采用一个**分割值**（通常选用当前数组中的第一个元素），分割值后面的元素都比分割值大，分割值前面的元素都比分割值要小。

> “递归”：条件满足的情况下，分别对分割值前面的元素和后面的元素采用分治步骤。

- # 核心代码：

```c++
int detach(Sqlist &S,int low,int high){
    ElemType pov=S.elem[low];
    while(low<high){
        while(low<high&&S.elem[high]>=pov)
            high--;
        S.elem[low]=S.elem[high];
        while(low<high&&S.elem[low]<=pov)
            low++;
        S.elem[high]=S.elem[low];
    }
    S.elem[low]=pov;//或者S.elem[high]=pov;
    return low;//或者high
}

void QuickSort(Sqlist &S,int low,int high){
    if(low<high){
        int pov=detach(S,low,high);
        QuickSort(S,low,pov-1);
        QuickSort(S,pov+1,high);
    }
}
```

------



- # 代码说明：

> QuickSort函数中，S为主函数传入的数组，low和high分别为数组第一个元素的下标和数组最后一个元素的下标（10个数的情况下，low为0，high为9）；detach函数用来实现分治思想中，分割值后面的元素都比分割值大，分割值前面的元素都比分割值要小。
>
> pov用来存放分隔值处理完之后，最终在有序数组中的位置（这个位置也就是最终排完序的位置）；分别对pov前面的数和后面的数进行相同处理。



> detach函数用来实现排序的操作和返回分割值最终在有序数组里位置；用low从第一个元素往后走，high从最后一个元素往前走，两边往中间逼近，不是同时走，一个动另一个不能动。
>
> pov临时变量用来存放当前数组的第一个元素（目的是最后将pov赋值到有序数组中的位置，用于比较的元素）；
>
> high从后往前走，如果值小于分割值将当前值赋值到low位置上。（low的值被覆盖会丢吗？不会因为存入临时变量pov中了。）**high不能动**，low开始从最低往后走，如果碰到一个位置的值大于分割值，将这个位置的值赋值到high位置上。high位置是上次比分割值小的值可以覆盖掉。进入外层循环判断当low和high的值，**low和high相等时不进入循环这个位置就是分割值在最后有序数组的位置**，将pov赋到这个位置上，**最后返回low或high都可以**。**加粗地方需要进行分析理解**。

------



- # 全部实现代码：

```c++
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
typedef int ElemType;
typedef struct{
    ElemType *elem;
    int len;
}Sqlist;
void Init(Sqlist &S,int n){
    S.len=n;
    S.elem=(ElemType *)malloc(sizeof (ElemType)*S.len);
    srand(time(NULL));
    for(int i=0;i<S.len;i++){
        S.elem[i]=rand()%100;
    }
}
void Print(Sqlist S){
    for(int i=0;i<S.len;i++){
        printf("%3d",S.elem[i]);
    }
    printf("\n");
}
int detach(Sqlist &S,int low,int high){
    ElemType pov=S.elem[low];
    while(low<high){
        while(low<high&&S.elem[high]>=pov)
            high--;
        S.elem[low]=S.elem[high];
        while(low<high&&S.elem[low]<=pov)
            low++;
        S.elem[high]=S.elem[low];
    }
    S.elem[high]=pov;
    return high;
}

void QuickSort(Sqlist &S,int low,int high){
    if(low<high){
        int pov=detach(S,low,high);
        QuickSort(S,low,pov-1);
        QuickSort(S,pov+1,high);
    }
}
int main(){
    Sqlist S;
    Init(S,10);
    Print(S);
    QuickSort(S,0,9);
    Print(S);
    return 0;
}
```

