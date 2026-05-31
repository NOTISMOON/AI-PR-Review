"use client";

import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Key,
  Brain,
  ChevronRight,
} from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
} from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#059669',
    },
    secondary: {
      main: '#0d9488',
    },
  },
});

export default function SettingsPage() {
  const router = useRouter();

  return (
    <ThemeProvider theme={theme}>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 p-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex items-center gap-4">
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => router.push('/')}
              startIcon={<ArrowLeft className="h-4 w-4" />}
            >
              返回首页
            </Button>
            <h1 className="text-3xl font-bold text-slate-800">设置</h1>
          </div>

          <div className="space-y-4">
            <div
              className="cursor-pointer"
              onClick={() => router.push('/settings/github-token')}
            >
              <Card className="shadow-lg transition-shadow hover:shadow-xl">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="rounded-lg bg-emerald-100 p-3">
                        <Key className="h-6 w-6 text-emerald-600" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold text-slate-800">GitHub Token</h2>
                        <p className="text-sm text-slate-600">配置 GitHub Personal Access Token</p>
                      </div>
                    </div>
                    <ChevronRight className="h-6 w-6 text-slate-400" />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div
              className="cursor-pointer"
              onClick={() => router.push('/settings/local-models')}
            >
              <Card className="shadow-lg transition-shadow hover:shadow-xl">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="rounded-lg bg-teal-100 p-3">
                        <Brain className="h-6 w-6 text-teal-600" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold text-slate-800">本地大模型</h2>
                        <p className="text-sm text-slate-600">管理本机配置的模型</p>
                      </div>
                    </div>
                    <ChevronRight className="h-6 w-6 text-slate-400" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}
