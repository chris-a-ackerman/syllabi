import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider } from './context/AuthProvider';
import { DataProvider } from './context/DataProvider';
import { ChatProvider } from './context/ChatProvider';
import { Toaster } from './components/ui/sonner';

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <ChatProvider>
          <RouterProvider router={router} />
          <Toaster />
        </ChatProvider>
      </DataProvider>
    </AuthProvider>
  );
}