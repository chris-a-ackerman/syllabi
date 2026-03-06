import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { ArrowLeft, Users, BookOpen, MessageSquare, Shield, Search } from 'lucide-react';
import { format } from 'date-fns';

type AdminTab = 'overview' | 'access' | 'users';

// Mock data for stats
const mockStats = {
  totalUsers: 1247,
  totalCourses: 3892,
  totalMessages: 15634,
  lastUpdated: new Date().toISOString(),
};

// Mock users data
const mockUsers = [
  {
    id: '1',
    displayName: 'Alex Chen',
    email: 'alex.chen@university.edu',
    joinedDate: '2025-08-15',
    courseCount: 5,
  },
  {
    id: '2',
    displayName: 'Jordan Smith',
    email: 'jordan.smith@university.edu',
    joinedDate: '2025-08-20',
    courseCount: 4,
  },
  {
    id: '3',
    displayName: 'Taylor Johnson',
    email: 'taylor.j@university.edu',
    joinedDate: '2025-09-01',
    courseCount: 6,
  },
  {
    id: '4',
    displayName: 'Morgan Lee',
    email: 'morgan.lee@university.edu',
    joinedDate: '2025-09-10',
    courseCount: 3,
  },
  {
    id: '5',
    displayName: 'Casey Brown',
    email: 'casey.brown@university.edu',
    joinedDate: '2025-09-15',
    courseCount: 4,
  },
];

export function AdminPanel() {
  const navigate = useNavigate();
  const { aiEnabled, setAiEnabled, courses } = useApp();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleToggleAI = (enabled: boolean) => {
    if (!enabled) {
      setShowDisableConfirm(true);
    } else {
      setAiEnabled(true);
    }
  };

  const handleConfirmDisable = () => {
    setAiEnabled(false);
    setShowDisableConfirm(false);
  };

  const filteredUsers = mockUsers.filter(user =>
    user.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/dashboard')}
              className="rounded-lg"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
            <div className="h-6 w-px bg-gray-300" />
            <h1 className="text-xl font-bold text-gray-900">Admin Panel</h1>
          </div>
          <Badge className="bg-indigo-100 text-indigo-700">
            <Shield className="mr-1 h-3 w-3" />
            Administrator
          </Badge>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Navigation */}
        <div className="flex gap-2 mb-8">
          <Button
            variant={activeTab === 'overview' ? 'default' : 'outline'}
            onClick={() => setActiveTab('overview')}
            className="rounded-lg"
          >
            Overview
          </Button>
          <Button
            variant={activeTab === 'access' ? 'default' : 'outline'}
            onClick={() => setActiveTab('access')}
            className="rounded-lg"
          >
            Access Control
          </Button>
          <Button
            variant={activeTab === 'users' ? 'default' : 'outline'}
            onClick={() => setActiveTab('users')}
            className="rounded-lg"
          >
            Users
          </Button>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="p-6 rounded-2xl shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                    <Users className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Total Users</p>
                    <p className="text-2xl font-bold text-gray-900">{mockStats.totalUsers}</p>
                  </div>
                </div>
              </Card>

              <Card className="p-6 rounded-2xl shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-violet-100 rounded-xl flex items-center justify-center">
                    <BookOpen className="w-6 h-6 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Courses Processed</p>
                    <p className="text-2xl font-bold text-gray-900">{mockStats.totalCourses}</p>
                  </div>
                </div>
              </Card>

              <Card className="p-6 rounded-2xl shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-pink-100 rounded-xl flex items-center justify-center">
                    <MessageSquare className="w-6 h-6 text-pink-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Chat Messages</p>
                    <p className="text-2xl font-bold text-gray-900">{mockStats.totalMessages}</p>
                  </div>
                </div>
              </Card>
            </div>

            <Card className="p-8 rounded-2xl shadow-sm">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-900 mb-2">System Status</h2>
                <Badge
                  className={`text-lg px-4 py-2 ${
                    aiEnabled
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {aiEnabled ? 'Active' : 'Disabled'}
                </Badge>
                <p className="text-sm text-gray-500 mt-4">
                  AI features are currently {aiEnabled ? 'enabled' : 'disabled'} for all users
                </p>
              </div>
            </Card>
          </div>
        )}

        {/* Access Control Tab */}
        {activeTab === 'access' && (
          <div className="space-y-6">
            <Card className="p-8 rounded-2xl shadow-sm">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    AI Features
                  </h2>
                  <p className="text-sm text-gray-600">
                    Control whether users can access AI chat and syllabus processing
                  </p>
                </div>
                <Switch
                  checked={aiEnabled}
                  onCheckedChange={handleToggleAI}
                  className="data-[state=checked]:bg-indigo-600"
                />
              </div>

              {aiEnabled ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-sm text-green-800">
                    ✓ All users can access AI chat and syllabus processing.
                  </p>
                </div>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-sm text-red-800">
                    ⚠ AI features are disabled for all users. Students will lose access to chat and syllabus processing until you re-enable it.
                  </p>
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-xs text-gray-500">
                  Last updated: {format(new Date(mockStats.lastUpdated), 'MMM d, yyyy h:mm a')}
                </p>
              </div>
            </Card>

            <Card className="p-8 rounded-2xl shadow-sm bg-gray-50">
              <h3 className="font-semibold text-gray-900 mb-4">About Access Control</h3>
              <div className="space-y-3 text-sm text-gray-700">
                <p>
                  • When AI features are <strong>enabled</strong>, all users can upload syllabi, process them with AI, and chat with the assistant.
                </p>
                <p>
                  • When AI features are <strong>disabled</strong>, users can still view existing course data but cannot process new syllabi or use the chat feature.
                </p>
                <p>
                  • This control is useful for maintenance periods or if you need to temporarily limit AI usage.
                </p>
              </div>
            </Card>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            <Card className="p-6 rounded-2xl shadow-sm">
              <div className="mb-6">
                <Label htmlFor="search">Search Users</Label>
                <div className="relative mt-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name or email..."
                    className="pl-10 rounded-lg"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Courses</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map(user => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.displayName}</TableCell>
                        <TableCell className="text-gray-600">{user.email}</TableCell>
                        <TableCell className="text-gray-600">
                          {format(new Date(user.joinedDate), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell>{user.courseCount}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="rounded-lg">
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {filteredUsers.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-gray-600">No users found</p>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* Disable Confirmation Dialog */}
      <AlertDialog open={showDisableConfirm} onOpenChange={setShowDisableConfirm}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Disable AI for all users?</AlertDialogTitle>
            <AlertDialogDescription>
              Students will lose access to chat and syllabus processing until you re-enable it. Existing course data will remain accessible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDisable}
              className="bg-red-600 hover:bg-red-700 rounded-lg"
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}