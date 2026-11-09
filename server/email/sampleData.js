import { getBaseAppUrlForEmail } from '../services/create/url.js';

export function getEmailTemplateSampleData() {
		const baseUrl = getBaseAppUrlForEmail();
		return {
			helloFromParascene: {
				recipientName: "Alex"
			},
			commentReceived: {
				recipientName: "Alex",
				commenterName: "Jordan",
				commentText: "This is a sample comment to show how the email template looks with real content. It demonstrates the formatting and layout.",
				creationTitle: "Sunset Over Mountains",
				creationUrl: `${baseUrl}/creations/123`
			},
			commentReceivedDelegated: {
				recipientName: "Alex",
				commenterName: "Jordan",
				commentText: "This is a sample comment to show how the email template looks with real content. It demonstrates the formatting and layout.",
				creationTitle: "Sunset Over Mountains",
				creationUrl: `${baseUrl}/creations/123`,
				impersonation: {
					originalRecipient: {
						name: "Taylor",
						email: "taylor@example.com",
						userId: 123
					},
					reason: "Suppressed recipient"
				}
			},
			featureRequest: {
				requesterName: "Sam",
				requesterEmail: "sam@example.com",
				requesterUserId: 42,
				requesterUserName: "sam",
				requesterDisplayName: "Sam",
				requesterRole: "consumer",
				requesterCreatedAt: "2024-01-15T10:30:00Z",
				message: "It would be great to have dark mode support. The current light theme is nice, but a dark option would be perfect for late-night browsing.",
				userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
				acceptLanguage: "en-US,en;q=0.9",
				referer: `${baseUrl}/feed`,
				forwardedFor: "192.168.1.1",
				ip: "192.168.1.1",
				ips: ["192.168.1.1"],
				context: {
					route: "/feed",
					timezone: "America/New_York",
					locale: "en-US",
					platform: "MacIntel",
					colorScheme: "light",
					reducedMotion: "no-preference",
					network: "4g",
					viewportWidth: 1920,
					viewportHeight: 1080,
					screenWidth: 1920,
					screenHeight: 1080,
					devicePixelRatio: 2
				},
				submittedAt: new Date().toISOString()
			},
			featureRequestFeedback: {
				recipientName: "Alex",
				originalRequest: "It would be great to have dark mode support. The current light theme is nice, but a dark option would be perfect for late-night browsing.",
				message: "We've added your idea to our roadmap. We'll reach out when we have something to share."
			},
			passwordReset: {
				recipientName: "Alex",
				resetUrl: `${baseUrl}/reset-password?rt=sample-token-123`
			},
			digestActivity: {
				recipientName: "Alex",
				activitySummary: "You have new activity on parascene — including chat.",
				feedUrl: `${baseUrl}/feed`,
				activityItems: [
					{ title: "Sunset Over Mountains", comment_count: 5 },
					{ title: "City Lights at Night", comment_count: 2 }
				],
				otherCreationsActivityItems: [
					{ title: "Ocean Waves", comment_count: 3 }
				],
				chatThreadItems: [
					{
						title: "#feedback",
						unread_count: 2,
						thread_url: `${baseUrl.replace(/\/+$/, "")}/chat/c/feedback`
					},
					{
						title: "DM · @jordan",
						unread_count: 1,
						thread_url: `${baseUrl.replace(/\/+$/, "")}/chat/dm/jordan`
					}
				]
			},
			welcome: {
				recipientName: "Alex"
			},
			firstCreationNudge: {
				recipientName: "Alex"
			},
			reengagement: {
				recipientName: "Alex"
			},
			creationHighlight: {
				recipientName: "Alex",
				creationTitle: "Sunset Over Mountains",
				creationUrl: `${baseUrl}/creations/123`,
				commentCount: 8
			},
			adminBroadcast: {
				recipientName: "Alex",
				emailSubject: "Two weeks left in the current challenge",
				headline: "Two weeks left in the current challenge",
				message:
					"The challenge closes soon. If you have not submitted yet, there is still time — and we would love to see what you make.",
				ctaText: "View challenges",
				ctaUrl: `${baseUrl}/connect#challenges`
			},
			founderRenewalAdmin: {
				status: "success",
				reason: "",
				userId: 218,
				userEmail: "batch08@gmail.com",
				userName: "seafoodboba19",
				displayName: "Alley One",
				subscriptionId: "sub_1UIHI2DHBvxoc5wCWt6KmF49",
				invoiceId: "in_1UT9aZDHBvxoc5wCTCmRS75l",
				credits: 700,
				amountPaidCents: 1200,
				eventId: "evt_1UTAXHDHBvxoc5wCM3XgdtHN",
				occurredAt: new Date().toISOString()
			},
			creditTopup: {
				recipientName: "Alex",
				credits: 700
			},
			founderWelcome: {
				recipientName: "Alex",
				credits: 700
			},
			founderRenewal: {
				recipientName: "Alex",
				credits: 700
			},
			supportReport: {
				requesterName: "Sam",
				requesterEmail: "sam@example.com",
				requesterUserId: 42,
				requesterUserName: "sam",
				requesterDisplayName: "Sam",
				report: {
					userSummary: "I see a grey box in the Landscape modal and no Generate button. I'm on Windows 11 with Brave.",
					creationId: 2116,
					landscape: {
						creationId: 2116,
						isOwner: true,
						hasImage: false,
						loading: false,
						errorMsg: null,
						genBtnExists: true,
						genBtnVisible: false,
						genBtnDisplay: "none",
						genPromptDisplay: "block",
						placeholderDisplay: "flex",
						errorElDisplay: "none"
					},
					domSummary: {
						modalDisplay: "block",
						modalOpen: true,
						placeholderDisplay: "flex",
						placeholderVisible: true,
						primaryBtnDisplay: "none",
						primaryBtnVisible: false,
						primaryBtnDisabled: false,
						modalContentLength: 420,
						modalContentSnippet: "<div class=\"landscape-placeholder\" data-landscape-placeholder>…"
					},
					context: {
						url: `${baseUrl}/creations/2116`,
						viewportWidth: 1920,
						viewportHeight: 1080,
						screenWidth: 1920,
						screenHeight: 1080,
						devicePixelRatio: 2
					}
				},
				userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				acceptLanguage: "en-US,en;q=0.9",
				referer: `${baseUrl}/creations/2116`,
				ip: "192.168.1.1",
				submittedAt: new Date().toISOString()
			}
		};
	}
