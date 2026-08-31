import { CardSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="py-8" aria-busy="true" aria-live="polite">
      <Skeleton className="h-9 w-2/3 max-w-md" />
      <Skeleton className="mt-3 h-4 w-72" />
      <Skeleton className="mt-6 h-40 w-full rounded-card" />
      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} />)}
      </div>
    </div>
  );
}
