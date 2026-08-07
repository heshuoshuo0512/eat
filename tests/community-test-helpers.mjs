import sharp from 'sharp';

const imageSource = sharp({
  create: {
    width: 2,
    height: 2,
    channels: 3,
    background: { r: 240, g: 240, b: 240 },
  },
});

export const imageFixtures = {
  png: (await imageSource.clone().png().toBuffer()).toString('base64'),
  jpeg: (await imageSource.clone().jpeg().toBuffer()).toString('base64'),
  webp: (await imageSource.clone().webp().toBuffer()).toString('base64'),
  gif: (await imageSource.clone().gif().toBuffer()).toString('base64'),
};

export async function completePublicProfile(request, token, nickname = 'Test Student') {
  const upload = await request('/api/uploads', {
    method: 'POST',
    token,
    body: {
      filename: 'profile.png',
      contentType: 'image/png',
      dataBase64: imageFixtures.png,
    },
  });
  if (upload.status !== 201) {
    throw new Error(`Profile image upload failed: ${upload.status} ${JSON.stringify(upload.data)}`);
  }

  const profile = await request('/api/account/profile', {
    method: 'PATCH',
    token,
    body: {
      nickname,
      avatarUrl: upload.data.reference || `upload://${upload.data.id}`,
    },
  });
  if (profile.status !== 200 || profile.data?.user?.profileComplete !== true) {
    throw new Error(`Public profile completion failed: ${profile.status} ${JSON.stringify(profile.data)}`);
  }
  return profile.data.user;
}
