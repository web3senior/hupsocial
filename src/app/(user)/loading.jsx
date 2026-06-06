import { ContentSpinner } from '@/components/Loading'

export default function Loading() {
  return (
    <div>
      {/* Title placeholder */}
      <p className="text-3xl font-bold mb-4">Profile</p>
      
      {/* List container for skeleton items */}
      <ul className="list-disc pl-6 mt-4 space-y-2">
        {[...Array(20).keys()].map((i) => (
          <li key={i} className="text-gray-300">
            {/* Animated skeleton bar with staggered delay */}
            <span
              className="inline-block h-5 w-4/5 bg-gray-300 rounded animate-pulse"
              style={{
                animationDelay: `${i * 0.05}s`,
                animationDuration: "1s",
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}