import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { formatDistanceToNow, format } from 'date-fns';
import {
  fetchApiKeyStatus,
  saveAnthropicKey,
  deleteAnthropicKey,
  testAnthropicKey,
  testCanvasToken,
} from '@/lib/api/apiKeys';
import { saveCanvasToken, deleteCanvasToken } from '@/lib/api/canvas';
import type { ApiKeyStatus } from '@/lib/types';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { ArrowLeft, Eye, EyeOff, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

export function Settings() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = async () => {
    const { data, error } = await fetchApiKeyStatus();
    if (!error && data) setStatus(data);
    setLoading(false);
  };

  useEffect(() => {
    loadStatus();
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg -ml-2"
            onClick={() => navigate('/dashboard')}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h1 className="text-xl font-bold text-indigo-600">Settings</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-6 py-10 space-y-8">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
          </div>
        ) : (
          <>
            <ClaudeKeyCard status={status} onChange={setStatus} />
            <CanvasCard status={status} onChange={setStatus} />
          </>
        )}
      </main>
    </div>
  );
}

function ClaudeKeyCard({
  status,
  onChange,
}: {
  status: ApiKeyStatus | null;
  onChange: (status: ApiKeyStatus) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaving(true);
    const { data, error } = await saveAnthropicKey(key);
    if (error || !data) {
      setSaveError(error?.message ?? 'Anthropic rejected this key');
      setSaving(false);
      return;
    }
    onChange({
      ...(status as ApiKeyStatus),
      has_anthropic_key: true,
      anthropic_key_last4: data.last4,
      anthropic_key_added_at: new Date().toISOString(),
      anthropic_key_last_tested_at: new Date().toISOString(),
      anthropic_key_last_test_ok: true,
    });
    setKey('');
    setEditing(false);
    setSaving(false);
    toast.success('Claude API key saved');
  };

  const handleTest = async () => {
    setTesting(true);
    const { data, error } = await testAnthropicKey();
    if (error || !data) {
      toast.error(error?.message ?? 'Could not test the key.');
      setTesting(false);
      return;
    }
    onChange({
      ...(status as ApiKeyStatus),
      anthropic_key_last_tested_at: data.tested_at,
      anthropic_key_last_test_ok: data.ok,
    });
    toast[data.ok ? 'success' : 'error'](data.ok ? 'Claude API key is working' : 'Claude API key was rejected');
    setTesting(false);
  };

  const handleRemove = async () => {
    setRemoving(true);
    const { error } = await deleteAnthropicKey();
    if (!error) {
      onChange({
        ...(status as ApiKeyStatus),
        has_anthropic_key: false,
        anthropic_key_last4: null,
        anthropic_key_added_at: null,
        anthropic_key_last_tested_at: null,
        anthropic_key_last_test_ok: null,
      });
      toast.success('Claude API key removed');
    }
    setRemoving(false);
    setShowRemoveDialog(false);
  };

  const showForm = !status?.has_anthropic_key || editing;

  return (
    <Card className="p-6 rounded-2xl shadow-sm border border-gray-200">
      <h3 className="text-base font-semibold text-gray-900 mb-1">Claude API Key</h3>
      <p className="text-sm text-gray-500 mb-5">
        Use your own Anthropic key. Requests made with it don't count against the app's daily
        limits.{' '}
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 hover:underline"
        >
          Where do I get a key?
        </a>
      </p>

      {showForm ? (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="anthropic-key">API Key</Label>
            <div className="relative">
              <Input
                id="anthropic-key"
                type={showKey ? 'text' : 'password'}
                placeholder="sk-ant-..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                className="rounded-lg pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}

          <div className="flex gap-3">
            {editing && (
              <Button
                type="button"
                variant="outline"
                className="rounded-lg"
                onClick={() => {
                  setEditing(false);
                  setKey('');
                  setSaveError(null);
                }}
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying…
                </>
              ) : (
                'Save & verify'
              )}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <p className="text-sm font-medium text-gray-800">sk-ant-…{status?.anthropic_key_last4}</p>
          {status?.anthropic_key_added_at && (
            <p className="text-sm text-gray-500 mt-1">
              Added {format(new Date(status.anthropic_key_added_at), 'MMM d, yyyy')}
            </p>
          )}
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
            {status?.anthropic_key_last_tested_at ? (
              <>
                Last tested {relativeTime(status.anthropic_key_last_tested_at)} —{' '}
                {status.anthropic_key_last_test_ok ? (
                  <span className="text-green-700 inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> working
                  </span>
                ) : (
                  <span className="text-red-600 inline-flex items-center gap-1">
                    <XCircle className="h-3.5 w-3.5" /> rejected
                  </span>
                )}
              </>
            ) : (
              'Not tested yet'
            )}
          </p>

          <div className="flex gap-3 mt-4">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
            </Button>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setEditing(true)}>
              Replace
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-red-600 hover:text-red-700"
              onClick={() => setShowRemoveDialog(true)}
            >
              Remove
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Claude API key?</AlertDialogTitle>
            <AlertDialogDescription>
              Requests will go back to using the app's shared key and its daily limits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={removing}
              className="rounded-lg bg-red-600 hover:bg-red-700 text-white"
            >
              {removing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Removing…</> : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CanvasCard({
  status,
  onChange,
}: {
  status: ApiKeyStatus | null;
  onChange: (status: ApiKeyStatus) => void;
}) {
  const [canvasUrl, setCanvasUrl] = useState('');
  const [canvasToken, setCanvasToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectError(null);
    setConnecting(true);
    const { error } = await saveCanvasToken(canvasToken, canvasUrl);
    if (error) {
      setConnectError(error.message ?? 'Failed to connect Canvas.');
      setConnecting(false);
      return;
    }
    onChange({
      ...(status as ApiKeyStatus),
      has_canvas_connected: true,
      canvas_base_url: canvasUrl,
      canvas_token_last_tested_at: new Date().toISOString(),
      canvas_token_last_test_ok: true,
    });
    setCanvasUrl('');
    setCanvasToken('');
    setRejected(false);
    toast.success('Canvas connected successfully');
    setConnecting(false);
  };

  const handleTest = async () => {
    setTesting(true);
    const { data, error } = await testCanvasToken();
    if (error || !data) {
      toast.error(error?.message ?? 'Could not test the connection.');
      setTesting(false);
      return;
    }
    onChange({
      ...(status as ApiKeyStatus),
      canvas_token_last_tested_at: new Date().toISOString(),
      canvas_token_last_test_ok: data.ok,
    });
    if (data.ok) {
      toast.success(`Connected as ${data.canvas_user}`);
      setRejected(false);
    } else {
      toast.error('Token rejected — reconnect');
      setRejected(true);
    }
    setTesting(false);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    const { error } = await deleteCanvasToken();
    if (!error) {
      onChange({
        ...(status as ApiKeyStatus),
        has_canvas_connected: false,
        canvas_base_url: null,
        canvas_token_last_tested_at: null,
        canvas_token_last_test_ok: null,
      });
      setRejected(false);
      toast.success('Canvas disconnected');
    }
    setDisconnecting(false);
    setShowDisconnectDialog(false);
  };

  const showConnectForm = !status?.has_canvas_connected || rejected;

  return (
    <Card id="canvas" className="p-6 rounded-2xl shadow-sm border border-gray-200 scroll-mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900">Canvas Integration</h3>
        {status?.has_canvas_connected && !rejected && (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100 gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Connected
          </Badge>
        )}
      </div>

      {showConnectForm ? (
        <>
          {rejected && (
            <p className="text-sm text-red-600 mb-4">Token rejected — reconnect below.</p>
          )}
          <p className="text-sm text-gray-500 mb-1">
            Enter your Canvas API token to automatically import your courses and assignments.
          </p>
          <a
            href="https://community.canvaslms.com/t5/Student-Guide/How-do-I-manage-API-access-tokens-as-a-student/ta-p/273"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-indigo-600 hover:underline mb-5 inline-block"
          >
            How do I find my Canvas API token?
          </a>

          <form onSubmit={handleConnect} className="space-y-4 mt-1">
            <div className="space-y-1.5">
              <Label htmlFor="canvas-url">Institution Canvas URL</Label>
              <Input
                id="canvas-url"
                type="text"
                placeholder="https://canvas.yale.edu"
                value={canvasUrl}
                onChange={(e) => setCanvasUrl(e.target.value)}
                required
                className="rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="canvas-token">API Token</Label>
              <div className="relative">
                <Input
                  id="canvas-token"
                  type={showToken ? 'text' : 'password'}
                  placeholder="Paste your token here"
                  value={canvasToken}
                  onChange={(e) => setCanvasToken(e.target.value)}
                  required
                  className="rounded-lg pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showToken ? 'Hide token' : 'Show token'}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {connectError && <p className="text-sm text-red-600">{connectError}</p>}

            <Button
              type="submit"
              disabled={connecting}
              className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting…
                </>
              ) : (
                'Connect Canvas'
              )}
            </Button>
          </form>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-1">Institution URL</p>
          <p className="text-sm font-medium text-gray-800 mb-1 break-all">{status?.canvas_base_url}</p>
          {status?.canvas_token_last_tested_at && (
            <p className="text-sm text-gray-500 mb-6">
              Last tested {relativeTime(status.canvas_token_last_tested_at)}
            </p>
          )}
          <div className={status?.canvas_token_last_tested_at ? 'flex gap-3' : 'flex gap-3 mt-6'}>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test connection'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => setShowDisconnectDialog(true)}
            >
              Disconnect
            </Button>
          </div>
        </>
      )}

      <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Canvas?</AlertDialogTitle>
            <AlertDialogDescription>
              You can reconnect anytime by entering your token again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="rounded-lg bg-gray-900 hover:bg-gray-800 text-white"
            >
              {disconnecting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Disconnecting…</>
              ) : (
                'Disconnect'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
