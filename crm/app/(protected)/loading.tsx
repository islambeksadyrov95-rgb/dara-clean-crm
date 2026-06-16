// Streaming-граница для всех страниц области (protected).
//
// Зачем (Next 16, §"Dynamic routes without loading.tsx"):
//  1. Мгновенный визуальный фидбек при навигации — скелет показывается сразу,
//     пока динамическая страница рендерится на сервере (а не «зависание» на
//     старой странице без реакции).
//  2. Дешёвый префетч: для динамических роутов Next префетчит ТОЛЬКО этот скелет
//     (частичный префетч), а не полный рендер. Это убирает шторм дорогих
//     RSC-префетчей ссылок сайдбара — каждая префетчится как лёгкий шелл.
//  3. Стриминг: общий layout (сайдбар/шапка) остаётся интерактивным.
//
// Скелет универсальный (шапка + таблица) — подходит под список/дашборд-страницы.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Загрузка">
      <div className="h-8 w-56 rounded-md bg-[#ece9e3]" />
      <div className="h-9 w-full max-w-md rounded-lg bg-[#f1efe9]" />
      <div className="overflow-hidden rounded-xl border border-[#ebe9e4] bg-white">
        {Array.from({ length: 8 }).map((_, row) => (
          <div key={row} className="flex h-12 items-center gap-4 border-b border-[#ebe9e4]/60 px-4 last:border-0">
            <div className="h-3.5 w-32 rounded bg-[#f1efe9]" />
            <div className="h-3.5 w-28 rounded bg-[#f4f2ec]" />
            <div className="ml-auto h-3.5 w-20 rounded bg-[#f4f2ec]" />
          </div>
        ))}
      </div>
    </div>
  )
}
