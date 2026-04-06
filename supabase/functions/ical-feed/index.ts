import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

type ClubRow = {
  id: string;
  club_name: string;
};

type EventRow = {
  id: string;
  club_id: string | null;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  address: string | null;
  room: string | null;
  description: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function escapeICS(value: string | null | undefined) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function fmt(dateStr: string, timeStr: string) {
  const clean = `${dateStr}T${String(timeStr || "").substring(0, 5)}:00`;
  const date = new Date(clean);
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildEventBlock(eventItem: EventRow, clubName: string) {
  const description = escapeICS(eventItem.description || "");
  const location = escapeICS([eventItem.address, eventItem.room].filter(Boolean).join(", "));

  return [
    "BEGIN:VEVENT",
    `UID:${escapeICS(`${eventItem.id}@clubcal.app`)}`,
    `SUMMARY:${escapeICS(`${eventItem.title} - ${clubName}`)}`,
    `DTSTART:${fmt(eventItem.date, eventItem.start_time)}`,
    `DTEND:${fmt(eventItem.date, eventItem.end_time)}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`,
    "STATUS:CONFIRMED",
    "END:VEVENT"
  ].join("\r\n");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const clubId = url.searchParams.get("club");

  if (!clubId) {
    return new Response("Missing club query parameter.", {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response("Supabase environment is not configured.", {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const { data: club, error: clubError } = await supabase
    .from("clubs")
    .select("id, club_name")
    .eq("id", clubId)
    .single<ClubRow>();

  if (clubError) {
    return new Response(clubError.message, {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("*")
    .eq("club_id", clubId);

  if (eventsError) {
    return new Response(eventsError.message, {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const calendarBody = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Club Cal//Club Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeICS(club.club_name)}`,
    `X-WR-CALDESC:${escapeICS(`Club Cal feed for ${club.club_name}`)}`,
    ...((events || []) as EventRow[])
      .sort((a, b) => `${a.date}T${a.start_time}`.localeCompare(`${b.date}T${b.start_time}`))
      .map((eventItem) => buildEventBlock(eventItem, club.club_name)),
    "END:VCALENDAR"
  ].join("\r\n");

  return new Response(calendarBody, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Content-Disposition": `inline; filename="${club.id}.ics"`
    }
  });
});
