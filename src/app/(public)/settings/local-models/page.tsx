"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Save,
  X,
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
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

interface LocalModel {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  createdAt: string;
}

export default function LocalModelsPage() {
  const router = useRouter();
  const [models, setModels] = useState<LocalModel[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<LocalModel | null>(null);

  // 表单状态
  const [modelName, setModelName] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = () => {
    const stored = localStorage.getItem('local_models');
    if (stored) {
      setModels(JSON.parse(stored));
    }
  };

  const saveModels = (newModels: LocalModel[]) => {
    localStorage.setItem('local_models', JSON.stringify(newModels));
    setModels(newModels);
  };

  const handleOpenDialog = (model?: LocalModel) => {
    if (model) {
      setEditingModel(model);
      setModelName(model.name);
      setApiUrl(model.apiUrl);
      setApiKey(model.apiKey);
    } else {
      setEditingModel(null);
      setModelName('');
      setApiUrl('');
      setApiKey('');
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingModel(null);
    setModelName('');
    setApiUrl('');
    setApiKey('');
    setShowApiKey(false);
  };

  const handleSaveModel = () => {
    if (!modelName.trim() || !apiUrl.trim()) {
      return;
    }

    if (editingModel) {
      const updatedModels = models.map(m =>
        m.id === editingModel.id
          ? { ...m, name: modelName.trim(), apiUrl: apiUrl.trim(), apiKey: apiKey.trim() }
          : m
      );
      saveModels(updatedModels);
    } else {
      const newModel: LocalModel = {
        id: Date.now().toString(),
        name: modelName.trim(),
        apiUrl: apiUrl.trim(),
        apiKey: apiKey.trim(),
        createdAt: new Date().toISOString(),
      };
      saveModels([...models, newModel]);
    }

    handleCloseDialog();
  };

  const handleDeleteModel = (id: string) => {
    const updatedModels = models.filter(m => m.id !== id);
    saveModels(updatedModels);
  };

  return (
    <ThemeProvider theme={theme}>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 p-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outlined"
                color="inherit"
                onClick={() => router.push('/settings')}
                startIcon={<ArrowLeft className="h-4 w-4" />}
              >
                返回设置
              </Button>
              <h1 className="text-3xl font-bold text-slate-800">本地大模型</h1>
            </div>
            <Button
              variant="contained"
              onClick={() => handleOpenDialog()}
              startIcon={<Plus className="h-4 w-4" />}
            >
              添加模型
            </Button>
          </div>

          <div className="space-y-4">
            <Alert severity="info">
              <AlertTitle>本地大模型配置</AlertTitle>
              配置本机的大模型 API。配置将保存在浏览器本地存储中。
            </Alert>

            {models.length === 0 ? (
              <Card className="shadow-lg">
                <CardContent className="p-12 text-center">
                  <p className="mb-4 text-slate-600">暂无配置的模型</p>
                  <Button
                    variant="contained"
                    onClick={() => handleOpenDialog()}
                    startIcon={<Plus className="h-4 w-4" />}
                  >
                    添加第一个模型
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-lg">
                <TableContainer component={Paper}>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell><strong>模型名称</strong></TableCell>
                        <TableCell><strong>API 地址</strong></TableCell>
                        <TableCell><strong>API Key</strong></TableCell>
                        <TableCell><strong>创建时间</strong></TableCell>
                        <TableCell align="right"><strong>操作</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {models.map((model) => (
                        <TableRow key={model.id} hover>
                          <TableCell>{model.name}</TableCell>
                          <TableCell className="max-w-xs truncate">{model.apiUrl}</TableCell>
                          <TableCell>
                            {model.apiKey ? '••••••••' : '未设置'}
                          </TableCell>
                          <TableCell>
                            {new Date(model.createdAt).toLocaleString('zh-CN')}
                          </TableCell>
                          <TableCell align="right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => handleOpenDialog(model)}
                              >
                                编辑
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="error"
                                onClick={() => handleDeleteModel(model.id)}
                                startIcon={<Trash2 className="h-3 w-3" />}
                              >
                                删除
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            )}

            <Alert severity="info">
              <AlertTitle>配置说明</AlertTitle>
              <div className="space-y-2 text-sm">
                <p>支持 OpenAI 兼容协议的模型配置，包括：</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li><strong>本地部署</strong>: Ollama (http://localhost:11434/v1)、LM Studio 等</li>
                  <li><strong>云端服务</strong>: DeepSeek、智谱 AI、通义千问等 OpenAI 兼容接口</li>
                </ul>
                <p className="mt-2 text-slate-600">配置将保存在浏览器本地存储中。</p>
              </div>
            </Alert>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          <div className="flex items-center justify-between">
            <span>{editingModel ? '编辑模型' : '添加模型'}</span>
            <IconButton onClick={handleCloseDialog} size="small">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </DialogTitle>
        <DialogContent>
          <div className="space-y-4 pt-2">
            <TextField
              fullWidth
              label="模型名称"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="llama3.2"
              helperText="例如：llama3.2, qwen2.5, deepseek-coder"
              required
            />

            <TextField
              fullWidth
              label="API 地址"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              helperText="OpenAI 兼容的 API 地址"
              required
            />

            <TextField
              fullWidth
              label="API Key (可选)"
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-xxxxxxxxxxxxxxxxxxxx"
              helperText="如果模型需要认证，请填写"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowApiKey(!showApiKey)}
                      edge="end"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} color="inherit">
            取消
          </Button>
          <Button
            onClick={handleSaveModel}
            variant="contained"
            startIcon={<Save className="h-4 w-4" />}
            disabled={!modelName.trim() || !apiUrl.trim()}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}
