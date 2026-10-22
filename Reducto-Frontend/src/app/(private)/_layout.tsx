import { useState } from 'react';
import { Redirect, Slot, usePathname } from 'expo-router';
import { useSession } from '../../context/SessionContext';
import { ChatsProvider } from '../../context/ChatsContext';
import { ProfilesProvider } from '../../context/ProfilesContext';
import { MediaMetadataProvider } from '../../context/MediaMetadataContext';
import { VideosProvider } from '../../context/VideosContext';
import { GifsProvider } from '../../context/GifsContext';
import { inviteTokenFromPath } from '../../lib/links';
function SignInRedirect({ token }: { token: string | null }) {
  // Keep the destination stable while navigation updates the current pathname.
  const [invite] = useState(token);
  return <Redirect href={invite ? { pathname: '/login', params: { invite } } : '/login'} />;
}
export default function PrivateLayout() {
  const { session } = useSession();
  const token = inviteTokenFromPath(usePathname());
  return session ? (
    <ProfilesProvider key={`${session.serverUrl}:${session.user.id}`}>
      <GifsProvider>
        <MediaMetadataProvider>
          <VideosProvider>
            <ChatsProvider>
              <Slot />
            </ChatsProvider>
          </VideosProvider>
        </MediaMetadataProvider>
      </GifsProvider>
    </ProfilesProvider>
  ) : (
    <SignInRedirect token={token} />
  );
}
