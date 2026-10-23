import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, Slot, usePathname } from 'expo-router';
import { useSession } from '../../context/SessionContext';
import { VoicePlaybackProvider } from '../../context/VoicePlaybackContext';
import { ChatsProvider } from '../../context/ChatsContext';
import { ProfilesProvider } from '../../context/ProfilesContext';
import { MediaMetadataProvider } from '../../context/MediaMetadataContext';
import { VideosProvider } from '../../context/VideosContext';
import { GifsProvider } from '../../context/GifsContext';
import { inviteTokenFromPath } from '../../lib/links';
import ChatShell from '../../features/chats/ChatShell';
import { MediaViewersProvider } from '../../features/chats/MediaViewers';
import { RetainedLayer } from '../../components/RetainedLayer';

function PrivateScreens() {
  const pathname = usePathname();
  const id = /^\/chat\/([^/]+)\/?$/.exec(pathname)?.[1];
  const chatting = pathname === '/' || !!id;
  return (
    <View style={{ flex: 1 }}>
      <RetainedLayer active={chatting}>
        <ChatShell id={id} active={chatting} />
      </RetainedLayer>
      <View style={chatting ? { display: 'none' } : { flex: 1 }}>
        <Slot />
      </View>
    </View>
  );
}
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
            <VoicePlaybackProvider>
              <ChatsProvider>
                <MediaViewersProvider>
                  <PrivateScreens />
                </MediaViewersProvider>
              </ChatsProvider>
            </VoicePlaybackProvider>
          </VideosProvider>
        </MediaMetadataProvider>
      </GifsProvider>
    </ProfilesProvider>
  ) : (
    <SignInRedirect token={token} />
  );
}
