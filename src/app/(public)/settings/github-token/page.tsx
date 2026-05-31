"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  Eye,
  EyeOff,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  TextField,
  Alert,
  AlertTitle,
  IconButton,
  InputAdornment,
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

export default function GitHubTokenPage() {
  const router = useRouter();
  const [githubToken, setGithubToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasExistingToken, setHasExistingToken] = useState(false);

  useEffect(() => {
    const existingToken = localStorage.getItem('github_token');
    if (existingToken) {
      setGithubToken(existingToken);
      setHasExistingToken(true);
    }
  }, []);

  const handleSave = () => {
    if (githubToken.trim()) {
      localStorage.setItem('github_token', githubToken.trim());
      setSaved(true);
      setHasExistingToken(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  const handleDelete = () => {
    localStorage.removeItem('github_token');
    setGithubToken('');
    setHasExistingToken(false);
  };

  return (
    <ThemeProvider theme={theme}>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 p-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex items-center gap-4">
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => router.push('/settings')}
              startIcon={<ArrowLeft className="h-4 w-4" />}
            >
              返回设置
            </Button>
            <h1 className="text-3xl font-bold text-slate-800">GitHub Token</h1>
          </div>

          <Card className="shadow-lg">
            <CardContent className="p-6">
              <div className="space-y-4">
                <Alert severity="info">
                  <AlertTitle>GitHub Token 配置</AlertTitle>
                  配置 GitHub Personal Access Token 以访问私有仓库和提高 API 限额。Token 将保存在浏览器本地存储中。
                </Alert>

                {hasExistingToken && (
                  <Alert severity="success">
                    已配置 GitHub Token
                  </Alert>
                )}

                <TextField
                  fullWidth
                  label="GitHub Token"
                  type={showToken ? 'text' : 'password'}
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowToken(!showToken)}
                          edge="end"
                        >
                          {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />

                <div className="flex gap-2">
                  <Button
                    variant="contained"
                    onClick={handleSave}
                    startIcon={<Save className="h-4 w-4" />}
                    disabled={!githubToken.trim()}
                  >
                    保存 Token
                  </Button>
                  {hasExistingToken && (
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={handleDelete}
                      startIcon={<Trash2 className="h-4 w-4" />}
                    >
                      删除 Token
                    </Button>
                  )}
                </div>

                {saved && (
                  <Alert severity="success">GitHub Token 已保存</Alert>
                )}

                <Alert severity="warning">
                  <AlertTitle>如何获取 GitHub Token？</AlertTitle>
                  <ol className="ml-4 list-decimal space-y-1 text-sm">
                    <li>访问 GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)</li>
                    <li>点击 "Generate new token (classic)"</li>
                    <li>选择权限：repo (完整仓库访问)</li>
                    <li>生成并复制 token</li>
                  </ol>
                </Alert>

                <Alert severity="info">
                  <AlertTitle>Token 权限说明</AlertTitle>
                  <ul className="ml-4 list-disc space-y-1 text-sm">
                    <li><strong>repo</strong>: 访问私有仓库的 PR 和代码</li>
                    <li><strong>public_repo</strong>: 仅访问公开仓库（如果只分析公开仓库）</li>
                  </ul>
                </Alert>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ThemeProvider>
  );
}
