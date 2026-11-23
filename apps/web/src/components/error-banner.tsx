import { ContractMismatchError } from '../lib/api-client';

/** A contract mismatch is shown as exactly that; anything else as the message the API (or the network) gave. */
export function ErrorBanner({ error }: { error: Error }) {
  if (error instanceof ContractMismatchError) {
    return (
      <div className="banner error" data-testid="contract-mismatch">
        Contract mismatch: the server's answer doesn't match what this page expects. Nothing is shown rather
        than something wrong. ({error.message})
      </div>
    );
  }
  return <div className="banner warn">{error.message}</div>;
}
