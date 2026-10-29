// SPDX-License-Identifier: GPL-3.0-only
.global _start
.text
_start:
    cmpq $3, (%rsp)
    jne badargs
    movq 16(%rsp), %rsi
    movq 24(%rsp), %r10
    movq $-100, %rdi
    movq $-100, %rdx
    movq $1, %r8
    movq $316, %rax
    syscall
    testq %rax, %rax
    jns done
    negq %rax
done:
    movq %rax, %rdi
    movq $60, %rax
    syscall
badargs:
    movq $125, %rdi
    movq $60, %rax
    syscall
