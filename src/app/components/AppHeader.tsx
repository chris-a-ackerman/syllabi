import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthProvider';
import { Button } from '../components/ui/button';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { ArrowLeft, Cog, Flag, ListChecks, LogOut, Menu, Settings2 } from 'lucide-react';

const FEEDBACK_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSfWB-gASY_vhg7xlHgXpdYavrDpX0qcZUmK7_zlaeFKHS2GSg/viewform';

interface AppHeaderProps {
  /** Renders the mobile-only hamburger that opens the sidebar drawer. */
  onMenuClick?: () => void;
  /** Renders a Back button ahead of the wordmark. */
  onBack?: () => void;
  /** Renders the Admin shortcut when the signed-in user is an admin. */
  showAdminLink?: boolean;
  /** Renders the Feedback button that opens the feedback form in a new tab. */
  showFeedbackLink?: boolean;
  /** Renders the desktop-only Agenda shortcut. */
  onAgendaClick?: () => void;
  /** Renders the desktop-only knowledge-base panel toggle. */
  onSettingsToggle?: () => void;
  /** Extra classes for the header row (e.g. `max-w-7xl mx-auto` to centre it). */
  contentClassName?: string;
}

/**
 * The shared app header: wordmark on the left, per-page actions and the account
 * dropdown on the right. Every action other than the account dropdown is opt-in
 * so each page renders only the affordances it actually has.
 */
export function AppHeader({
  onMenuClick,
  onBack,
  showAdminLink = false,
  showFeedbackLink = false,
  onAgendaClick,
  onSettingsToggle,
  contentClassName = '',
}: AppHeaderProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="border-b border-gray-200 px-6 py-4">
      <div className={`flex items-center justify-between ${contentClassName}`}>
        <div className={`flex items-center ${onBack ? 'gap-4' : 'gap-2'}`}>
          {onMenuClick && (
            <Button
              onClick={onMenuClick}
              variant="ghost"
              size="sm"
              className="rounded-lg md:hidden -ml-2"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5 text-gray-600" />
            </Button>
          )}
          {onBack && (
            <Button variant="ghost" onClick={onBack} className="rounded-lg">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          )}
          <h1 className="text-xl font-bold text-indigo-600">Syllabi</h1>
        </div>

        <div className="flex items-center gap-3">
          {showAdminLink && user?.isAdmin && (
            <Button
              onClick={() => navigate('/admin')}
              variant="outline"
              size="sm"
              className="rounded-lg"
            >
              <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">Admin</Badge>
            </Button>
          )}

          {showFeedbackLink && (
            <Button
              onClick={() => window.open(FEEDBACK_FORM_URL, '_blank')}
              variant="outline"
              size="sm"
              className="rounded-lg gap-1.5"
            >
              <Flag className="h-4 w-4 text-gray-700" />
              <span className="text-sm font-medium text-gray-900 tracking-tight">Feedback</span>
            </Button>
          )}

          {onAgendaClick && (
            <Button
              onClick={onAgendaClick}
              variant="ghost"
              size="sm"
              className="rounded-lg hidden md:inline-flex"
              title="Agenda"
              aria-label="Agenda"
            >
              <ListChecks className="h-5 w-5 text-gray-600" />
            </Button>
          )}

          {onSettingsToggle && (
            <Button
              onClick={onSettingsToggle}
              variant="ghost"
              size="sm"
              className="rounded-lg hidden md:inline-flex"
              aria-label="Toggle knowledge base"
            >
              <Settings2 className="h-5 w-5 text-gray-600" />
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="rounded-full p-0 h-10 w-10">
                <Avatar>
                  <AvatarFallback className="bg-indigo-100 text-indigo-600">
                    {user?.avatar}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-lg">
              <div className="px-2 py-1.5 text-sm font-medium">{user?.displayName}</div>
              <div className="px-2 py-1.5 text-xs text-gray-500">{user?.email}</div>
              <DropdownMenuItem onClick={() => navigate('/settings/canvas')}>
                <Cog className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
