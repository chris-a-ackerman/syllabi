import { useState, useEffect } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { listAgentTokens, createAgentToken, revokeAgentToken } from '@/lib/api/agentTokens';
import {
  agentTokenStatus,
  agentTokenExpiryLabel,
  groupAgentTokens,
  type AgentTokenStatus,
} from '@/lib/agentTokenStatus';
import type { AgentToken } from '@/lib/types';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// Must stay within create-agent-token's 1–180 day window.
const EXPIRY_OPTIONS = [7, 30, 90, 180];
const DEFAULT_EXPIRY_DAYS = 30;

const STATUS_BADGE: Record<AgentTokenStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-green-100 text-green-700 hover:bg-green-100' },
  expired: { label: 'Expired', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100' },
  revoked: { label: 'Revoked', className: 'bg-gray-100 text-gray-600 hover:bg-gray-100' },
};

/**
 * Settings → Agent access (SYL-104): mint, list and revoke the scoped,
 * read-only agent tokens that `agent-upcoming` accepts (SYL-92).
 */
export function AgentAccessCard() {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AgentToken | null>(null);

  const loadTokens = async () => {
    const { data, error } = await listAgentTokens();
    if (error || !data) {
      setLoadError(true);
    } else {
      setTokens(data);
      setLoadError(false);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTokens();
  }, []);

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    const { error } = await revokeAgentToken(revokeTarget.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Agent token revoked');
    }
    await loadTokens();
  };

  const { active, inactive } = groupAgentTokens(tokens);

  return (
    <Card
      id="agent-access"
      className="p-6 rounded-2xl shadow-sm border border-gray-200 scroll-mt-6"
    >
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base font-semibold text-gray-900">Agent access</h3>
        <Button
          size="sm"
          className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
          onClick={() => setShowGenerate(true)}
        >
          Generate token
        </Button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Tokens let an AI agent read your upcoming classes and deadlines. They're read-only and can't
        change anything in your account.
      </p>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
        </div>
      ) : loadError ? (
        <p className="text-sm text-red-600">Could not load your agent tokens.</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-gray-500">No agent tokens yet.</p>
      ) : (
        <div className="space-y-3">
          {active.length === 0 && <p className="text-sm text-gray-500">No active agent tokens.</p>}
          {active.map((token) => (
            <TokenRow key={token.id} token={token} onRevoke={() => setRevokeTarget(token)} />
          ))}

          {inactive.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowInactive((v) => !v)}
                className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700"
                aria-expanded={showInactive}
              >
                {showInactive ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Inactive ({inactive.length})
              </button>
              {showInactive && (
                <div className="space-y-3 mt-3">
                  {inactive.map((token) => (
                    <TokenRow key={token.id} token={token} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <GenerateTokenDialog
        open={showGenerate}
        onOpenChange={setShowGenerate}
        onCreated={loadTokens}
      />

      <ConfirmDeleteDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="Revoke agent token?"
        description="Any agent using this token loses access immediately. This can't be undone — generate a new token to reconnect."
        confirmLabel="Revoke"
        onConfirm={handleRevoke}
      />
    </Card>
  );
}

function TokenRow({ token, onRevoke }: { token: AgentToken; onRevoke?: () => void }) {
  const status = agentTokenStatus(token);
  const badge = STATUS_BADGE[status];

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-800 truncate">
              {token.label ?? 'Unlabeled token'}
            </p>
            <Badge className={badge.className}>{badge.label}</Badge>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Created {format(new Date(token.created_at), 'MMM d, yyyy')} ·{' '}
            {token.last_used_at
              ? `Last used ${formatDistanceToNow(new Date(token.last_used_at), { addSuffix: true })}`
              : 'Never used'}
          </p>
          <p className="text-sm text-gray-500 mt-0.5">
            {status === 'revoked' && token.revoked_at
              ? `Revoked ${formatDistanceToNow(new Date(token.revoked_at), { addSuffix: true })}`
              : agentTokenExpiryLabel(token)}
          </p>
        </div>
        {onRevoke && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg text-red-600 hover:text-red-700 shrink-0"
            onClick={onRevoke}
          >
            Revoke
          </Button>
        )}
      </div>
    </div>
  );
}

function GenerateTokenDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(DEFAULT_EXPIRY_DAYS);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // The raw token lives only here, only until the dialog closes — never
  // persisted, logged or shown in a toast.
  const [rawToken, setRawToken] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setLabel('');
      setExpiresInDays(DEFAULT_EXPIRY_DAYS);
      setCreateError(null);
      setRawToken(null);
    }
    onOpenChange(next);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    const { data, error } = await createAgentToken({ label, expiresInDays });
    setCreating(false);
    if (error || !data) {
      setCreateError(error?.message ?? 'Could not generate a token.');
      return;
    }
    setRawToken(data.token);
    onCreated();
  };

  const handleCopy = async () => {
    if (!rawToken) return;
    try {
      await navigator.clipboard.writeText(rawToken);
      toast.success('Token copied');
    } catch {
      toast.error('Could not copy — select the token and copy it manually.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="rounded-2xl max-w-lg">
        {rawToken ? (
          <>
            <DialogHeader>
              <DialogTitle>Your new agent token</DialogTitle>
              <DialogDescription>
                Paste it into your agent's configuration. It's read-only and expires in{' '}
                {expiresInDays} days.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={rawToken}
                  aria-label="Agent token"
                  className="rounded-lg font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button variant="outline" className="rounded-lg shrink-0" onClick={handleCopy}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </Button>
              </div>
              <p className="text-sm text-amber-700 flex items-start gap-1.5">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                You won't be able to see this again. Copy it now.
              </p>
            </div>
            <DialogFooter>
              <Button
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => handleOpenChange(false)}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Generate agent token</DialogTitle>
              <DialogDescription>
                A read-only token for an AI agent to fetch your upcoming classes and deadlines.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="agent-token-label">Label (optional)</Label>
              <Input
                id="agent-token-label"
                placeholder="e.g. Claude on my laptop"
                value={label}
                maxLength={100}
                onChange={(e) => setLabel(e.target.value)}
                className="rounded-lg"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="agent-token-expiry">Expires after</Label>
              <Select
                value={String(expiresInDays)}
                onValueChange={(v) => setExpiresInDays(Number(v))}
              >
                <SelectTrigger id="agent-token-expiry" className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  {EXPIRY_OPTIONS.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {days} days
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {createError && <p className="text-sm text-red-600">{createError}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="rounded-lg"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating…
                  </>
                ) : (
                  'Generate'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
