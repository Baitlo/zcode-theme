/* zcode-patcher launcher
 *
 * launchd 直接执行 node 时没有 "App 管理" TCC 权限,对 /Applications 内
 * 文件的写流会被 macOS 断流。通过 open(1) 启动一个带 bundle 身份的
 * 助手 App 来跑补丁脚本,就能以 App 自己的签名身份获得并记住授权。
 *
 * 本程序只做一件事:exec node patch.mjs。
 * 两个路径在编译期通过 -D 注入(install.sh 自动完成):
 *   NODE_PATH    node 可执行文件的绝对路径(launchd 下 PATH 极简,不能用 env 找)
 *   PATCH_SCRIPT patch.mjs 的绝对路径
 */
#include <stdio.h>
#include <unistd.h>

#ifndef NODE_PATH
#error "compile with -DNODE_PATH=\"/abs/path/to/node\""
#endif
#ifndef PATCH_SCRIPT
#error "compile with -DPATCH_SCRIPT=\"/abs/path/to/patch.mjs\""
#endif

int main(void) {
    execl(NODE_PATH, NODE_PATH, PATCH_SCRIPT, (char *)NULL);
    perror("execl " NODE_PATH);
    return 1;
}
