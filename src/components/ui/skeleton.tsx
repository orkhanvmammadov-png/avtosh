export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-line ${className}`} />;
}

/** Card-shaped skeleton matching ListingCard proportions (4:3 image). */
export function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-white">
      <Skeleton className="aspect-vehicle w-full rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}
