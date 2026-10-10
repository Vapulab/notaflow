import { MeProvider } from './components/MeContext';
import { AdminPage } from './pages/AdminPage';
import { CustomerPage } from './pages/CustomerPage';
import { CustomersPage } from './pages/CustomersPage';
import { EmitterPage } from './pages/EmitterPage';
import { EmittersPage } from './pages/EmittersPage';
import { HomePage } from './pages/HomePage';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { IssuePage } from './pages/IssuePage';
import { MembersPage } from './pages/MembersPage';
import { NewInvoicePage } from './pages/NewInvoicePage';
import { useRoute } from './router';

export function App() {
  return (
    <MeProvider>
      <Screen />
    </MeProvider>
  );
}

function Screen() {
  const route = useRoute();
  switch (route.name) {
    case 'emitters':
      return <EmittersPage accountId={route.accountId} />;
    case 'emitter':
      return <EmitterPage accountId={route.accountId} emitterId={route.emitterId} />;
    case 'invoices':
      return <InvoicesPage accountId={route.accountId} />;
    case 'invoice':
      return <InvoiceDetailPage accountId={route.accountId} invoiceId={route.invoiceId} />;
    case 'newInvoice':
      return (
        <NewInvoicePage
          accountId={route.accountId}
          {...(route.customerId ? { customerId: route.customerId } : {})}
        />
      );
    case 'issue':
      return <IssuePage accountId={route.accountId} invoiceId={route.invoiceId} />;
    case 'customers':
      return <CustomersPage accountId={route.accountId} />;
    case 'customer':
      return <CustomerPage accountId={route.accountId} customerId={route.customerId} />;
    case 'members':
      return <MembersPage accountId={route.accountId} />;
    case 'admin':
      return <AdminPage />;
    default:
      return <HomePage />;
  }
}
