// SPDX-License-Identifier: GPL-3.0-only
.global _start
.text
_start:
    ldr x8, [sp]
    cmp x8, #3
    b.ne badargs
    ldr x1, [sp, #16]
    ldr x3, [sp, #24]
    mov x0, #-100
    mov x2, #-100
    mov x4, #1
    mov x8, #276
    svc #0
    cmp x0, #0
    b.ge quit
    neg x0, x0
quit:
    mov x8, #93
    svc #0
badargs:
    mov x0, #125
    b quit
