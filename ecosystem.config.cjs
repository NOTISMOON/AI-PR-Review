// PM2 进程编排（单容器多进程负载均衡）：
//   nginx(监听3000，对外唯一入口) -> 轮询 -> review-web-1/2/3(3001/3002/3003)  +  review-worker(消费者)
//   frp: xg-2.frp.one:43323 -> 容器 3000（nginx）即可，无需改隧道。
// 以 .cjs 保存（package.json 为 "type":"module"，PM2 需 CommonJS 配置）
// 由 Dockerfile 的 CMD 通过 pm2-runtime 加载（PID 1 代理，停止时给子进程发 SIGTERM）。
module.exports = {
  apps: [
    // ---- 反向代理负载均衡入口 ----
    {
      name: 'review-nginx',
      cwd: '/app',
      script: 'nginx',
      args: '-c /app/nginx.conf -g "daemon off;"',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      env: { NODE_ENV: 'production' },
    },
    // ---- Next.js 多实例（各独立端口），数量可按需增删并同步 nginx.conf 的 upstream ----
    ...[3001, 3002, 3003].map((port) => ({
      name: `review-web-${port}`,
      cwd: '/app',
      script: 'pnpm',
      args: 'run start:prod',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      listen_timeout: 15000,
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'production',
        PORT: String(port),
      },
    })),
    // ---- RabbitMQ 审查队列消费者：单实例 ----
    {
      name: 'review-worker',
      cwd: '/app',
      script: 'pnpm',
      args: 'run start:worker',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,            // 保证只有一个消费者消费队列
      autorestart: true,
      max_memory_restart: '1G',
      max_restarts: 20,        // RabbitMQ 未就绪时脚本退出，限制重启次数避免死循环
      restart_delay: 5000,
      env: { NODE_ENV: 'production' },
    },
  ],
};