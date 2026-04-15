import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';
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
import { ArrowLeft, Eye, EyeOff, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface CanvasProfile {
  has_canvas_connected: boolean;
  canvas_base_url: string | null;
}

export function CanvasSettings() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CanvasProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Connect form state
  const [canvasUrl, setCanvasUrl] = useState('');
  const [canvasToken, setCanvasToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Disconnect dialog state
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchProfile = async () => {
    const { data, error } = await supabase
      .from('profiles_safe')
      .select('has_canvas_connected, canvas_base_url')
      .single();
    if (!error && data) {
      setProfile(data as CanvasProfile);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectError(null);
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setConnectError('Not authenticated. Please sign in again.');
        return;
      }
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/save-canvas-token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            canvas_token: canvasToken,
            canvas_base_url: canvasUrl,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        setConnectError(json.error ?? 'Failed to connect Canvas.');
        return;
      }
      await fetchProfile();
      setCanvasUrl('');
      setCanvasToken('');
      toast.success('Canvas connected successfully');
    } catch {
      setConnectError('Unexpected error. Please try again.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-canvas-token`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );
      if (res.ok) {
        await fetchProfile();
        toast.success('Canvas disconnected');
      }
    } finally {
      setDisconnecting(false);
      setShowDisconnectDialog(false);
    }
  };

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

      <main className="max-w-lg mx-auto px-6 py-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Canvas Integration</h2>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
          </div>
        ) : profile?.has_canvas_connected ? (
          /* ── State B: Connected ── */
          <Card className="p-6 rounded-2xl shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Canvas Connected</h3>
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100 gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected
              </Badge>
            </div>
            <p className="text-sm text-gray-500 mb-1">Institution URL</p>
            <p className="text-sm font-medium text-gray-800 mb-6 break-all">
              {profile.canvas_base_url}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => setShowDisconnectDialog(true)}
            >
              Disconnect
            </Button>
          </Card>
        ) : (
          /* ── State A: Not connected ── */
          <Card className="p-6 rounded-2xl shadow-sm border border-gray-200">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Connect Canvas</h3>
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
                  onChange={e => setCanvasUrl(e.target.value)}
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
                    onChange={e => setCanvasToken(e.target.value)}
                    required
                    className="rounded-lg pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showToken ? 'Hide token' : 'Show token'}
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {connectError && (
                <p className="text-sm text-red-600">{connectError}</p>
              )}

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
          </Card>
        )}
      </main>

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
    </div>
  );
}
